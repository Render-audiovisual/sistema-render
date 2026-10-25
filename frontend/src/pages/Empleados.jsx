import React, { useCallback, useEffect, useRef, useState } from "react";
import { getSesion, normalizarPrimerNombre } from "../utils.jsx";
import { useScopedRequest } from '../shared/session/use-scoped-request.js';
import { isSessionFailure } from '../shared/session/captured-request.js';
import { useNavigationGuard } from '../shared/navigation/useNavigationGuard.js';
import { Modal } from "../components/Modal.jsx";
import { getRolLabel, ROL_LABELS } from "../constants.js";

const employeeId = value => Number.isSafeInteger(value) && value > 0 && value <= 2147483647;
function employeeRevision(value, id) {
  const match = typeof value === 'string' && /^ua1:([1-9]\d*):([1-9]\d*)$/.exec(value);
  if (!employeeId(id) || !match || match[0] !== value || Number(match[1]) !== id || !employeeId(Number(match[2]))) return null;
  return Number(match[2]);
}
function mergeEmployeeAck(before, value, id, required = []) {
  if (!employeeId(id) || value?.id !== id || !['nombre','usuario','rol'].every(key => typeof value[key] === 'string' && value[key].trim())
    || !employeeRevision(value.admin_revision,id) || required.some(key => !Object.hasOwn(value,key))) throw new Error('No se pudo verificar la respuesta del usuario. Revisá el registro antes de repetir la operación.');
  if (Object.hasOwn(before,'admin_revision') && (!employeeRevision(before.admin_revision,id) || employeeRevision(value.admin_revision,id) !== employeeRevision(before.admin_revision,id) + 1)) throw new Error('La respuesta no confirmó la siguiente revisión del usuario.');
  const result = { ...before, id };
  for (const key of ['nombre','usuario','rol','email_notificaciones','google_email','foto_perfil','created_at','activo','whatsapp_vinculado','admin_revision']) {
    if (!Object.hasOwn(value,key)) continue;
    if (['activo','whatsapp_vinculado'].includes(key) ? typeof value[key] !== 'boolean' : value[key] !== null && typeof value[key] !== 'string') throw new Error('La respuesta del usuario no es válida.');
    result[key] = value[key];
  }
  return result;
}
function employeeRoster(value) {
  if (!Array.isArray(value)) throw new Error('La lista de usuarios no es válida.');
  const rows = value.map(row => mergeEmployeeAck({},row,row?.id,['activo']));
  if (new Set(rows.map(row => row.id)).size !== rows.length) throw new Error('La lista de usuarios contiene duplicados.');
  return rows;
}
function generateEmployeePassword(random = globalThis.crypto) {
  if (typeof random?.getRandomValues !== 'function') throw new Error('La generación segura no está disponible. Ingresá una contraseña propia.');
  const bytes = new Uint8Array(12); random.getRandomValues(bytes);
  return Array.from(bytes,byte => byte.toString(16).padStart(2,'0')).join('');
}

export function EmpleadosPage({ sesion }) {
  const { view } = useScopedRequest(sesion || getSesion(),'employees');
  const identity = useRef({ view, epoch:0 });
  if (identity.current.view !== view) identity.current = { view, epoch:identity.current.epoch + 1 };
  if (view.role !== 'admin') return <main><p role="alert">La administración de usuarios está reservada a administradores.</p></main>;
  return <EmpleadosContent key={identity.current.epoch} sesion={view.session} />;
}

function EmpleadosContent({ sesion }) {
  const [usuarios, setUsuarios] = useState([]);
  const [cargandoUsuarios, setCargandoUsuarios] = useState(true);
  const [error, setError] = useState(null);
  const [modalAltaAbierto, setModalAltaAbierto] = useState(false);
  const [usuarioAdministrado, setUsuarioAdministrado] = useState(null);
  const [nombre, setNombre] = useState("");
  const [usuario, setUsuario] = useState("");
  const [rol, setRol] = useState("diseno");
  const [rolPersonalizado, setRolPersonalizado] = useState("");
  const [password, setPassword] = useState("");
  const [emailNotificaciones, setEmailNotificaciones] = useState("");
  const [correoEdicion, setCorreoEdicion] = useState("");
  const [editandoCorreo, setEditandoCorreo] = useState(false);
  const [guardandoCorreo, setGuardandoCorreo] = useState(false);
  const [googleEmailEdicion, setGoogleEmailEdicion] = useState("");
  const [editandoGoogleEmail, setEditandoGoogleEmail] = useState(false);
  const [guardandoGoogleEmail, setGuardandoGoogleEmail] = useState(false);
  const [whatsappEdicion, setWhatsappEdicion] = useState("");
  const [editandoWhatsapp, setEditandoWhatsapp] = useState(false);
  const [guardandoWhatsapp, setGuardandoWhatsapp] = useState(false);
  const [enviandoInvitacion, setEnviandoInvitacion] = useState(false);
  const [editandoDatos, setEditandoDatos] = useState(false);
  const [guardandoDatos, setGuardandoDatos] = useState(false);
  const [nombreEdicion, setNombreEdicion] = useState("");
  const [usuarioEdicion, setUsuarioEdicion] = useState("");
  const [rolEdicion, setRolEdicion] = useState("");
  const [rolPersonalizadoEdicion, setRolPersonalizadoEdicion] = useState("");
  const [formError, setFormError] = useState(null);
  const [mensaje, setMensaje] = useState(null);
  const [enviando, setEnviando] = useState(false);
  const [busqueda, setBusqueda] = useState("");
  const [filtroAcceso, setFiltroAcceso] = useState("todos");
  const { view, capture, captureLifetime, epoch } = useScopedRequest(sesion,modalAltaAbierto ? 'create' : `user:${usuarioAdministrado?.id || 'list'}`);
  const { capture: captureRoster } = useScopedRequest(sesion,'employee-roster');
  const pending = useRef(false), listGeneration = useRef(0);
  const createButtonRef = useRef(null), createNameRef = useRef(null);
  const [mutationBusy,setMutationBusy] = useState(false);
  const editObservations = useRef({}), blockedTargetsRef = useRef(new Set());
  const [blockedTargets,setBlockedTargets] = useState({});
  const recoveryIntent = useRef(null);
  const [recoveryRequested,setRecoveryRequested] = useState(false);
  const clearRecovery = () => { recoveryIntent.current = null; setRecoveryRequested(false); };
  const heldUser = (kind, user) => editObservations.current[kind]?.id === user.id ? editObservations.current[kind] : user;
  const blockTarget = id => {
    blockedTargetsRef.current.add(id);
    setBlockedTargets(previous => ({...previous,[id]:true}));
  };

  const handleNombreChange = event => {
    if (pending.current) return;
    const next = event.target.value, suggested = normalizarPrimerNombre(nombre);
    setNombre(next);
    if (!usuario || usuario === suggested) setUsuario(normalizarPrimerNombre(next));
  };

  const cargarUsuarios = useCallback(async ({ guard, signal, afterWrite = false } = {}) => {
    if (pending.current && !afterWrite) return;
    const scope = guard || captureRoster(), generation = ++listGeneration.current;
    if (!scope.current()) return;
    setCargandoUsuarios(true);
    try {
      const rows = employeeRoster(await scope.request('/api/usuarios', { method:'GET', cache:'no-store', ...(signal ? {signal} : {}) }));
      if (!scope.current() || signal?.aborted || generation !== listGeneration.current) return;
      setError(null); setUsuarios(rows);
      // Never replace a held editor or its draft with a roster refresh.
    } catch (reason) {
      if (scope.current() && !signal?.aborted && generation === listGeneration.current) {
        if (afterWrite) throw reason;
        if (!isSessionFailure(reason)) setError('No se pudieron cargar los empleados.');
      }
    } finally { if (scope.current() && !signal?.aborted && generation === listGeneration.current) setCargandoUsuarios(false); }
  }, [captureRoster]);

  useEffect(() => {
    const controller = new AbortController();
    cargarUsuarios({ signal:controller.signal });
    return () => { controller.abort(); listGeneration.current += 1; };
  }, [cargarUsuarios]);

  const altaDirty = Boolean(nombre || usuario || password || emailNotificaciones || rol !== 'diseno' || rolPersonalizado);
  const adminDirty = Boolean(
    editandoCorreo && correoEdicion !== (usuarioAdministrado?.email_notificaciones || '')
    || editandoGoogleEmail && googleEmailEdicion !== (usuarioAdministrado?.google_email || '')
    || editandoWhatsapp && whatsappEdicion
    || editandoDatos && (nombreEdicion !== usuarioAdministrado?.nombre || usuarioEdicion !== usuarioAdministrado?.usuario
      || (rolEdicion === '__otra__' ? rolPersonalizadoEdicion !== getRolLabel(usuarioAdministrado?.rol) : rolEdicion !== usuarioAdministrado?.rol))
  );
  const employeeNavigationStatus = () => {
    if (!capture().current()) return { dirty: false, busy: false };
    return { dirty: Boolean(modalAltaAbierto && altaDirty || usuarioAdministrado && adminDirty), busy: Boolean(pending.current) };
  };
  useNavigationGuard(employeeNavigationStatus);
  const allowDiscard = dirty => !pending.current && capture().current()
    && (!dirty || window.confirm('¿Descartar los cambios sin guardar?'));

  const cerrarAlta = () => {
    if (!allowDiscard(altaDirty)) return;
    setModalAltaAbierto(false); setFormError(null); setPassword('');
  };
  const cerrarAdministracion = () => {
    if (!allowDiscard(adminDirty)) return;
    clearRecovery();
    setUsuarioAdministrado(null); setEditandoCorreo(false); setEditandoGoogleEmail(false);
    setEditandoWhatsapp(false); setEditandoDatos(false); setFormError(null);
  };
  const cancelEdit = setter => {
    if (!allowDiscard(adminDirty)) return;
    setter(false); setFormError(null);
  };
  const abrirAlta = () => {
    if (!allowDiscard(modalAltaAbierto ? altaDirty : adminDirty)) return;
    clearRecovery();
    editObservations.current = {}; setUsuarioAdministrado(null); setNombre(''); setUsuario(''); setRol('diseno'); setRolPersonalizado('');
    setPassword(''); setEmailNotificaciones(''); setFormError(null); setMensaje(null); setModalAltaAbierto(true);
  };
  const abrirAdministracion = u => {
    if (!employeeId(u?.id) || !allowDiscard(modalAltaAbierto ? altaDirty : adminDirty)) return;
    clearRecovery();
    editObservations.current = {}; setModalAltaAbierto(false); setPassword(''); setUsuarioAdministrado(u);
    setCorreoEdicion(u.email_notificaciones || ''); setGoogleEmailEdicion(u.google_email || '');
    setWhatsappEdicion(''); setEditandoWhatsapp(false); setEditandoCorreo(false); setEditandoGoogleEmail(false); setEditandoDatos(false);
    setFormError(null); setMensaje(null);
  };
  const closeRef = useRef(cerrarAdministracion); closeRef.current = cerrarAdministracion;
  useEffect(() => {
    if (!usuarioAdministrado) return;
    const escape = event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeRef.current(); } };
    window.addEventListener('keydown',escape); return () => window.removeEventListener('keydown',escape);
  }, [Boolean(usuarioAdministrado)]);

  const mergeLocal = (row, guard) => {
    guard.assertCurrent();
    setUsuarios(previous => previous.some(user => user.id === row.id) ? previous.map(user => user.id === row.id ? {...user,...row} : user) : [...previous,row]);
    setUsuarioAdministrado(previous => previous?.id === row.id ? {...previous,...row} : previous);
  };
  const requestReloadManagedUser = () => {
    if (pending.current || !employeeId(usuarioAdministrado?.id)) return;
    const guard = capture(), lifetime = captureLifetime(), id = usuarioAdministrado.id;
    if (!guard.current() || !blockedTargetsRef.current.has(id)) return;
    recoveryIntent.current = Object.freeze({guard,lifetime,id});
    setRecoveryRequested(true);
  };
  const cancelReloadManagedUser = () => {
    if (pending.current || !recoveryIntent.current?.guard.current()) return;
    clearRecovery();
  };
  const reloadManagedUser = async () => {
    const intent = recoveryIntent.current;
    if (pending.current || !intent || !intent.guard.current() || intent.id !== usuarioAdministrado?.id) return;
    const {guard,lifetime,id} = intent;
    pending.current = true; listGeneration.current += 1; setMutationBusy(true);
    try {
      const rows = employeeRoster(await guard.request('/api/usuarios',{method:'GET',cache:'no-store'}));
      const latest = rows.find(user => user.id === id);
      if (!latest) throw new Error('El usuario ya no está disponible. Conservamos el borrador sin cambiar de persona.');
      guard.assertCurrent();
      if (recoveryIntent.current !== intent) return;
      setUsuarios(rows); setUsuarioAdministrado(latest);
      setCorreoEdicion(latest.email_notificaciones || ''); setGoogleEmailEdicion(latest.google_email || ''); setWhatsappEdicion('');
      setNombreEdicion(latest.nombre); setUsuarioEdicion(latest.usuario); setRolEdicion(ROL_LABELS[latest.rol] ? latest.rol : '__otra__'); setRolPersonalizadoEdicion(ROL_LABELS[latest.rol] ? '' : getRolLabel(latest.rol));
      setEditandoCorreo(false); setEditandoGoogleEmail(false); setEditandoWhatsapp(false); setEditandoDatos(false);
      editObservations.current = {}; blockedTargetsRef.current.delete(id);
      setBlockedTargets(previous => { const next = {...previous}; delete next[id]; return next; });
      clearRecovery();
      setFormError(null); setError(null); setMensaje('Usuario recargado. Revisá los datos guardados antes de volver a modificarlos.');
    } catch (reason) {
      if (guard.current() && !isSessionFailure(reason)) setFormError('No se pudo recargar este usuario. Conservamos el borrador y el bloqueo; no se repitió ninguna escritura.');
    } finally { pending.current = false; if (lifetime.current()) setMutationBusy(false); }
  };
  const runMutation = async ({ target, requestTargetId, path, body, method = 'PATCH', required = [], validate, onConfirmed, onComplete, busySetter, refresh = true, guard: originalGuard }) => {
    if (pending.current) return;
    const guard = originalGuard || capture(), lifetime = captureLifetime();
    if (!guard.current() || view.role !== 'admin' || target && (!employeeId(target.id) || target.id !== usuarioAdministrado?.id)
      || requestTargetId !== undefined && (!employeeId(requestTargetId) || requestTargetId !== usuarioAdministrado?.id)) return;
    if (target && blockedTargetsRef.current.has(target.id)) { setFormError('Revisá y recargá este usuario antes de volver a guardar. Conservamos el borrador.'); return; }
    if (target && !employeeRevision(target.admin_revision,target.id)) { blockTarget(target.id); setFormError('Falta una revisión válida del usuario. Recargá el registro guardado antes de modificarlo.'); return; }
    // Serialize before any await; follow-up reads retain this exact action.
    const payload = target ? {...body,expected_revision:target.admin_revision} : body;
    const options = { method, ...(payload === undefined ? {} : {headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)}) };
    pending.current = true; listGeneration.current += 1; setMutationBusy(true); busySetter?.(true);
    setFormError(null); setMensaje(null);
    try {
      const data = await guard.request(path,options);
      guard.assertCurrent();
      const row = target ? mergeEmployeeAck(target,data,target.id,required) : data;
      validate?.(row); guard.assertCurrent();
      if (target) mergeLocal(row,guard);
      onConfirmed?.(row,guard); guard.assertCurrent();
      if (refresh) {
        try { await cargarUsuarios({guard,afterWrite:true}); }
        catch (reason) { if (guard.current()) setError('El cambio se confirmó, pero no se pudo actualizar la lista. No repitas la operación; reintentá sólo la lectura.'); }
      }
      guard.assertCurrent(); onComplete?.(row);
    } catch (reason) {
      if (guard.current() && !isSessionFailure(reason)) {
        if (reason.status === 409 && reason.code === 'LOGIN_IDENTIFIER_UNAVAILABLE') {
          setFormError('Ese usuario o email de acceso no está disponible. Elegí otro.');
        } else if (target && (reason.status === 409 || !Number.isInteger(reason.status) || reason.status >= 500)) {
          blockTarget(target.id); setFormError('El registro cambió o no se pudo confirmar el resultado. Conservamos el borrador. Revisá y recargá este mismo usuario antes de guardar otra vez.');
        } else setFormError(reason.message || 'No se pudo confirmar la operación. Revisá el registro antes de repetirla.');
      }
    }
    finally { pending.current = false; if (lifetime.current()) { setMutationBusy(false); busySetter?.(false); setCargandoUsuarios(false); } }
  };

  const guardarWhatsapp = (u, valor = whatsappEdicion) => runMutation({
    target:heldUser('whatsapp',u),path:`/api/usuarios/${u.id}/whatsapp`,body:{whatsapp:valor},required:['whatsapp_vinculado'],busySetter:setGuardandoWhatsapp,
    validate:row => { if (row.whatsapp_vinculado !== (valor === null ? false : Boolean(valor.trim()))) throw new Error('No se confirmó el vínculo de WhatsApp.'); },
    onConfirmed:row => { setMensaje(row.whatsapp_vinculado ? `WhatsApp vinculado para ${row.nombre}.` : `WhatsApp desvinculado para ${row.nombre}.`); setWhatsappEdicion(''); setEditandoWhatsapp(false); },
  });
  const iniciarEdicionWhatsapp = () => {
    if (pending.current || !capture().current()) return;
    editObservations.current.whatsapp = {...usuarioAdministrado}; setWhatsappEdicion(''); setEditandoWhatsapp(true);
  };
  const handleCrear = event => {
    event.preventDefault();
    if (pending.current || !modalAltaAbierto) return;
    const body = {nombre,usuario,rol:rol === '__otra__' ? rolPersonalizado : rol,password,email_notificaciones:emailNotificaciones};
    return runMutation({path:'/api/usuarios',method:'POST',body,busySetter:setEnviando,
      validate:data => {
        mergeEmployeeAck({},data,data?.id,['activo','google_email','whatsapp_vinculado','email_notificaciones']);
        if (employeeRevision(data.admin_revision,data.id) !== 1 || data.nombre !== body.nombre.trim() || data.usuario !== body.usuario.trim() || data.activo !== true || data.google_email !== null || data.whatsapp_vinculado !== false
          || (data.email_notificaciones || '') !== body.email_notificaciones.trim().toLowerCase()) throw new Error('No se pudo verificar el alta. Revisá la lista antes de repetirla.');
      },
      onConfirmed:(data,guard) => { const row = mergeEmployeeAck({},data,data.id); mergeLocal(row,guard); setMensaje(`Empleado creado: ${row.nombre} (${row.usuario}).`); setPassword(''); },
      onComplete:() => { setNombre(''); setUsuario(''); setRol('diseno'); setRolPersonalizado(''); setEmailNotificaciones(''); setModalAltaAbierto(false); },
    });
  };
  const handleEliminar = u => {
    if (pending.current || !employeeId(u?.id)) return;
    const guard = capture(); if (!guard.current()) return;
    const activo = u.activo === false;
    if (!window.confirm(activo ? `¿Reactivar el acceso de ${u.nombre}?` : `¿Dar de baja a ${u.nombre} (${u.usuario})? Perderá el acceso, pero se conservará su historial.`)) return;
    return runMutation({target:u,guard,path:`/api/usuarios/${u.id}/acceso`,body:{activo},required:['activo'],
      validate:row => { if (row.activo !== activo) throw new Error('No se confirmó el estado del acceso.'); },
      onConfirmed:row => setMensaje(row.activo ? `Acceso reactivado para ${row.nombre}.` : `${row.nombre} fue dado de baja. Su historial se conserva.`),
    });
  };
  const iniciarEdicionCorreo = () => {
    if (pending.current || !capture().current()) return;
    editObservations.current.correo = {...usuarioAdministrado};
    setCorreoEdicion(usuarioAdministrado?.email_notificaciones || ''); setEditandoCorreo(true); setFormError(null); setMensaje(null);
  };
  const guardarCorreo = u => runMutation({
    target:heldUser('correo',u),path:`/api/usuarios/${u.id}/email-notificaciones`,body:{email_notificaciones:correoEdicion},required:['email_notificaciones'],busySetter:setGuardandoCorreo,
    validate:row => { if ((row.email_notificaciones || '') !== correoEdicion.trim().toLowerCase()) throw new Error('No se confirmó el correo de notificaciones.'); },
    onConfirmed:row => { setMensaje(row.email_notificaciones ? `Correo guardado para ${row.nombre}.` : `Correo eliminado para ${row.nombre}.`); setEditandoCorreo(false); },
  });
  const iniciarEdicionGoogleEmail = () => {
    if (pending.current || !capture().current()) return;
    editObservations.current.google = {...usuarioAdministrado};
    setGoogleEmailEdicion(usuarioAdministrado?.google_email || ""); setEditandoGoogleEmail(true); setFormError(null); setMensaje(null);
  };
  const enviarInvitacion = u => runMutation({
    target:null,requestTargetId:u.id,path:`/api/usuarios/${u.id}/invitacion`,method:'POST',busySetter:setEnviandoInvitacion,refresh:false,
    validate:data => { if (u.id !== usuarioAdministrado?.id || data?.ok !== true || typeof data.destinatario !== 'string' || !data.destinatario.trim()) throw new Error('No se pudo confirmar el envío de instrucciones. Verificá antes de repetirlo.'); },
    onConfirmed:data => setMensaje(`Instrucciones enviadas a ${data.destinatario}.`),
  });
  const guardarGoogleEmail = u => runMutation({
    target:heldUser('google',u),path:`/api/usuarios/${u.id}/google-email`,body:{google_email:googleEmailEdicion},required:['google_email'],busySetter:setGuardandoGoogleEmail,
    validate:row => { if ((row.google_email || '') !== googleEmailEdicion.trim().toLowerCase()) throw new Error('No se confirmó el email de Google.'); },
    onConfirmed:row => { setMensaje(row.google_email ? `Email de Google guardado para ${row.nombre}.` : `Email de Google eliminado para ${row.nombre}.`); setEditandoGoogleEmail(false); },
  });
  const iniciarEdicionDatos = () => {
    if (pending.current || !capture().current()) return;
    editObservations.current.datos = {...usuarioAdministrado};
    setNombreEdicion(usuarioAdministrado?.nombre || ''); setUsuarioEdicion(usuarioAdministrado?.usuario || '');
    const actual = usuarioAdministrado?.rol || 'diseno';
    setRolEdicion(ROL_LABELS[actual] ? actual : '__otra__'); setRolPersonalizadoEdicion(ROL_LABELS[actual] ? '' : getRolLabel(actual));
    setEditandoDatos(true); setFormError(null); setMensaje(null);
  };
  const guardarDatos = u => {
    if (!nombreEdicion.trim() || !usuarioEdicion.trim()) { if (!pending.current) setFormError('El nombre y el usuario no pueden estar vacíos.'); return; }
    const body = {nombre:nombreEdicion,usuario:usuarioEdicion,rol:rolEdicion === '__otra__' ? rolPersonalizadoEdicion : rolEdicion};
    return runMutation({target:heldUser('datos',u),path:`/api/usuarios/${u.id}`,body,busySetter:setGuardandoDatos,
      validate:row => { if (row.nombre !== body.nombre.trim() || row.usuario !== body.usuario.trim()) throw new Error('No se confirmaron los datos del usuario.'); },
      onConfirmed:() => { setMensaje('Datos actualizados correctamente.'); setEditandoDatos(false); },
    });
  };

  const iniciales = (texto = "") =>
    texto
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((parte) => parte[0])
      .join("")
      .toUpperCase();

  const usuariosConCorreo = usuarios.filter(
    (u) => Boolean(u.email_notificaciones),
  ).length;
  const usuariosSinCorreo = usuarios.length - usuariosConCorreo;
  const usuariosConGoogle = usuarios.filter((u) => Boolean(u.google_email)).length;
  const usuariosVisibles = usuarios.filter((u) => {
    const texto = `${u.nombre} ${u.usuario} ${u.email_notificaciones || ""} ${u.google_email || ""} ${getRolLabel(u.rol)}`.toLowerCase();
    const coincideBusqueda = texto.includes(busqueda.trim().toLowerCase());
    const requiereAtencion = !u.email_notificaciones || !u.google_email;
    return coincideBusqueda && (filtroAcceso === "atencion" ? requiereAtencion : true);
  });
  const usuariosConAtencion = usuarios.filter((u) => !u.email_notificaciones || !u.google_email).length;

  return (
    <main aria-label="Render platform empleados">
      <div className="frame">
        <div className="content usuarios-page">
          <div className="usuarios-header">
            <div>
              <div className="section-label">Equipo</div>
              <h2>Usuarios y accesos</h2>
              <p>Revisá quién puede ingresar, su rol y cómo recibe el acceso.</p>
            </div>
            <button ref={createButtonRef} className="btn primary usuarios-add" type="button" disabled={mutationBusy} onClick={abrirAlta}>
              + Agregar usuario
            </button>
          </div>

          <div className="usuarios-stats" aria-label="Resumen de usuarios">
            <div className="usuarios-stat">
              <span>Personas con acceso</span>
              <strong>{usuarios.filter(user => user.activo === true).length}</strong>
              <small>Cuentas activas</small>
            </div>
            <div className="usuarios-stat is-ready">
              <span>Correo configurado</span>
              <strong>{usuariosConCorreo}</strong>
              <small>{usuariosSinCorreo ? `${usuariosSinCorreo} pendiente` : "Equipo completo"}</small>
            </div>
            <div className={`usuarios-stat ${usuariosConGoogle === usuarios.length ? "is-ready" : "is-pending"}`}>
              <span>Acceso con Google</span>
              <strong>{usuariosConGoogle}</strong>
              <small>{usuarios.length - usuariosConGoogle ? `${usuarios.length - usuariosConGoogle} sin vincular` : "Todos vinculados"}</small>
            </div>
          </div>

          {error && <div className="usuarios-alert is-error"><span>{error}</span><button type="button" disabled={mutationBusy} onClick={() => cargarUsuarios()}>Reintentar</button></div>}
          {mensaje && <div className="usuarios-alert is-success">{mensaje}</div>}

          <section className="usuarios-listado" aria-label="Listado de usuarios">
            <div className="usuarios-listado-header">
              <div>
                <strong>Personas</strong>
                <span>{usuariosVisibles.length} de {usuarios.length} cuentas</span>
              </div>
              <div className="usuarios-list-controls">
                <label className="usuarios-search">
                  <span aria-hidden="true">⌕</span>
                  <input value={busqueda} onChange={(event) => setBusqueda(event.target.value)} placeholder="Buscar persona o correo" aria-label="Buscar persona o correo" />
                </label>
                <div className="usuarios-access-filter" aria-label="Filtrar cuentas">
                  <button type="button" className={filtroAcceso === "todos" ? "active" : ""} onClick={() => setFiltroAcceso("todos")}>Todos</button>
                  <button type="button" className={filtroAcceso === "atencion" ? "active" : ""} onClick={() => setFiltroAcceso("atencion")}>Atención {usuariosConAtencion > 0 && <b>{usuariosConAtencion}</b>}</button>
                </div>
              </div>
            </div>

            <div className="usuarios-columns" aria-hidden="true">
              <span>Persona</span>
              <span>Rol</span>
              <span>Correo</span>
              <span>Estado de acceso</span>
              <span />
            </div>

            <div className="usuarios-list">
              {usuariosVisibles.map((u) => (
                <article className="usuarios-row" key={u.id}>
                  <div className="usuarios-persona">
                    <div className="usuarios-avatar">
                      {u.foto_perfil ? (
                        <img src={u.foto_perfil} alt="" />
                      ) : (
                        iniciales(u.nombre)
                      )}
                    </div>
                    <div>
                      <strong>{u.nombre}</strong>
                      <span>@{u.usuario}</span>
                    </div>
                  </div>

                  <div className={`usuarios-role role-${u.rol}`}>
                    {getRolLabel(u.rol)}
                  </div>

                  <div className="usuarios-access">
                    <span className="usuarios-mobile-label">Correo</span>
                    <strong>{u.email_notificaciones || "Sin correo configurado"}</strong>
                  </div>

                  <div className="usuarios-access-status">
                    <span className={u.email_notificaciones ? "is-ready" : "is-pending"}>
                      <i className={`usuarios-dot ${u.email_notificaciones ? "is-ready" : "is-pending"}`} />
                      {u.email_notificaciones ? "Correo listo" : "Falta correo"}
                    </span>
                    <span className={u.google_email ? "is-ready" : "is-pending"}>
                      <i className={`usuarios-dot ${u.google_email ? "is-ready" : "is-pending"}`} />
                      {u.google_email ? "Google vinculado" : "Google sin vincular"}
                    </span>
                  </div>

                  <button
                    className="btn usuarios-manage"
                    type="button"
                    disabled={mutationBusy}
                    onClick={() => abrirAdministracion(u)}
                  >
                    Administrar <span aria-hidden="true">→</span>
                  </button>
                </article>
              ))}

              {cargandoUsuarios && <div className="usuarios-loading"><span aria-hidden="true" />Cargando usuarios…</div>}
              {usuarios.length === 0 && !error && !cargandoUsuarios && (
                <div className="usuarios-empty">
                  No hay usuarios cargados todavía.
                </div>
              )}
              {usuarios.length > 0 && usuariosVisibles.length === 0 && !cargandoUsuarios && (
                <div className="usuarios-empty">No hay cuentas que coincidan con esta búsqueda.</div>
              )}
            </div>
          </section>
        </div>
      </div>

      {modalAltaAbierto && (
        <Modal
          key={`${epoch}:create`}
          native
          closeDisabled={mutationBusy}
          initialFocusRef={createNameRef}
          returnFocusRef={createButtonRef}
          onClose={cerrarAlta}
          overlayAriaLabel="Agregar usuario"
          closeOnBackdropClick
          style={{ maxWidth: "720px" }}
          title={
            <div>
              <span className="usuarios-eyebrow">Nuevo acceso</span>
              <h3 style={{ margin: 0 }}>Agregar usuario</h3>
              <p style={{ color: "var(--muted)", fontSize: "12px", margin: "6px 0 0" }}>
                Creá la cuenta y dejá listo su correo de notificaciones.
              </p>
            </div>
          }
        >
            <form className="modal-body" onSubmit={handleCrear}>
              <fieldset disabled={mutationBusy} style={{border:0,margin:0,padding:0,minWidth:0}}>
              <div className="form-grid cols-2 usuarios-form-grid">
                <label className="form-field">
                  <span>Nombre y apellido *</span>
                  <input ref={createNameRef} type="text" value={nombre} onChange={handleNombreChange} maxLength={200} required />
                </label>
                <label className="form-field">
                  <span>Categoría laboral *</span>
                  <select value={rol} onChange={(e) => setRol(e.target.value)}>
                    {Object.entries(ROL_LABELS).map(([key, label]) => (
                      <option key={key} value={key}>{label}</option>
                    ))}
                    <option value="__otra__">Otra categoría…</option>
                  </select>
                </label>
                {rol === "__otra__" && (
                  <label className="form-field">
                    <span>Nombre de la categoría *</span>
                    <input
                      type="text"
                      value={rolPersonalizado}
                      placeholder="Ej. Fotografía, Ventas…"
                      onChange={(e) => setRolPersonalizado(e.target.value)}
                      required
                    />
                  </label>
                )}
                <label className="form-field">
                  <span>Usuario de acceso *</span>
                  <input
                    type="text"
                    value={usuario}
                    placeholder="ej: Luciano"
                    maxLength={128}
                    onChange={(e) => setUsuario(e.target.value)}
                    required
                  />
                </label>
                <label className="form-field">
                  <span>Contraseña inicial * <small style={{fontWeight: 400, color: 'var(--muted)'}}>(mín. 12 caracteres)</small></span>
                  <div className="usuarios-password-field">
                    <input
                      type="password"
                      autoComplete="new-password"
                      value={password}
                      placeholder="Contraseña segura"
                      onChange={(e) => setPassword(e.target.value)}
                      required
                      minLength={12}
                    />
                    <button
                      type="button"
                      className="btn"
                      onClick={() => {
                        if (pending.current || !capture().current()) return;
                        try { setPassword(generateEmployeePassword()); } catch (reason) { setFormError(reason.message); }
                      }}
                      title="Generar contraseña segura"
                    >
                      Generar
                    </button>
                  </div>
                  <small>Al menos 12 caracteres y hasta 72 bytes UTF-8; el servidor valida la contraseña. La persona puede cambiarla desde Mi perfil; no se exige un cambio automático.</small>
                </label>
                <label className="form-field usuarios-form-email">
                  <span>Correo para notificaciones</span>
                  <input
                    type="email"
                    value={emailNotificaciones}
                    placeholder="nombre@gmail.com"
                    onChange={(e) => setEmailNotificaciones(e.target.value)}
                  />
                  <small>Solo para avisos, no para iniciar sesión. Ingresá con el usuario de acceso o el email de Google configurado explícitamente por un administrador. Puede agregarse después desde Administrar.</small>
                </label>
              </div>

              {formError && <div className="usuarios-alert is-error">{formError}</div>}

              <div className="modal-actions">
                <button className="btn" type="button" onClick={cerrarAlta} disabled={enviando}>
                  Cancelar
                </button>
                <button className="btn primary" type="submit" disabled={enviando}>
                  {enviando ? "Creando..." : "Crear usuario"}
                </button>
              </div>
              </fieldset>
            </form>
        </Modal>
      )}

      {usuarioAdministrado && (
        <div key={`${epoch}:${usuarioAdministrado.id}`} className="usuarios-modal-backdrop" role="presentation" onMouseDown={cerrarAdministracion}>
          <aside
            className="usuarios-panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="administrar-usuario-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="usuarios-panel-header">
              <button
                className="usuarios-close"
                type="button"
                onClick={cerrarAdministracion}
                aria-label="Cerrar"
              >
                ×
              </button>
              <div className="usuarios-panel-identity">
                <div className="usuarios-avatar is-large">
                  {usuarioAdministrado.foto_perfil ? (
                    <img src={usuarioAdministrado.foto_perfil} alt="" />
                  ) : (
                    iniciales(usuarioAdministrado.nombre)
                  )}
                </div>
                <div>
                  <span className="usuarios-eyebrow">Cuenta del equipo</span>
                  <h3 id="administrar-usuario-title">{usuarioAdministrado.nombre}</h3>
                  <div className={`usuarios-role role-${usuarioAdministrado.rol}`}>
                    {getRolLabel(usuarioAdministrado.rol)}
                  </div>
                </div>
              </div>
            </div>

            {blockedTargets[usuarioAdministrado.id] && <div className="usuarios-alert" role="status">
              {recoveryRequested ? <>
                <span>¿Descartar el borrador y cargar los datos guardados de {usuarioAdministrado.nombre}?</span>
                <div className="usuarios-inline-actions">
                  <button className="btn" type="button" autoFocus disabled={mutationBusy} onClick={cancelReloadManagedUser}>Conservar borrador</button>
                  <button className="btn primary" type="button" disabled={mutationBusy} onClick={reloadManagedUser}>{mutationBusy ? 'Recargando…' : 'Descartar y recargar'}</button>
                </div>
              </> : <>
                <span>Guardado bloqueado. Tu borrador se conserva.</span>
                <button className="btn" type="button" disabled={mutationBusy} onClick={requestReloadManagedUser}>Revisar y recargar usuario</button>
              </>}
            </div>}
            <fieldset className="usuarios-panel-body" disabled={mutationBusy || Boolean(blockedTargets[usuarioAdministrado.id])} style={{border:0,margin:0,minWidth:0}}>
              {formError && <div className="usuarios-alert is-error">{formError}</div>}

              <section className="usuarios-panel-section">
                <div className="usuarios-panel-section-title">
                  <div>
                    <strong>WhatsApp de Mía</strong>
                    <span>Permite administrar la Lista privada y recibir recordatorios</span>
                  </div>
                  {!editandoWhatsapp && (
                    <button className="btn" type="button" onClick={iniciarEdicionWhatsapp}>
                      {usuarioAdministrado.whatsapp_vinculado ? "Cambiar" : "Vincular"}
                    </button>
                  )}
                </div>
                {editandoWhatsapp ? (
                  <div className="usuarios-email-editor">
                    <label className="form-field">
                      <span>Número con código de país</span>
                      <input type="tel" value={whatsappEdicion} placeholder="+54 9 3794..." onChange={(event) => setWhatsappEdicion(event.target.value)} autoFocus />
                      <small>El número se guarda protegido; después solo se muestra su estado.</small>
                    </label>
                    <div className="usuarios-inline-actions">
                      {usuarioAdministrado.whatsapp_vinculado && (
                        <button className="btn" type="button" disabled={guardandoWhatsapp} onClick={() => guardarWhatsapp(usuarioAdministrado, "")}>Desvincular</button>
                      )}
                      <button className="btn" type="button" disabled={guardandoWhatsapp} onClick={() => cancelEdit(setEditandoWhatsapp)}>Cancelar</button>
                      <button className="btn primary" type="button" disabled={guardandoWhatsapp || !whatsappEdicion.trim()} onClick={() => guardarWhatsapp(usuarioAdministrado)}>
                        {guardandoWhatsapp ? "Guardando..." : "Vincular WhatsApp"}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className={`usuarios-notification-card ${usuarioAdministrado.whatsapp_vinculado ? "is-ready" : "is-pending"}`}>
                    <i className={`usuarios-dot ${usuarioAdministrado.whatsapp_vinculado ? "is-ready" : "is-pending"}`} />
                    <div>
                      <strong>{usuarioAdministrado.whatsapp_vinculado ? "WhatsApp vinculado" : "WhatsApp pendiente"}</strong>
                      <span>{usuarioAdministrado.whatsapp_vinculado ? "Mía reconoce a esta persona y puede operar su Lista privada." : "Mía no modificará su Lista hasta que se vincule el número."}</span>
                    </div>
                  </div>
                )}
              </section>

              <section className="usuarios-panel-section">
                <div className="usuarios-panel-section-title">
                  <div>
                    <strong>Identidad y categoría</strong>
                    <span>Nombre, usuario y función dentro del equipo</span>
                  </div>
                  {!editandoDatos && (
                    <button className="btn" type="button" onClick={iniciarEdicionDatos}>
                      Editar
                    </button>
                  )}
                </div>

                {editandoDatos ? (
                  <div className="usuarios-data-editor">
                    <div className="form-grid cols-2">
                      <label className="form-field">
                        <span>Nombre</span>
                        <input
                          type="text"
                          value={nombreEdicion}
                          onChange={(e) => setNombreEdicion(e.target.value)}
                          disabled={guardandoDatos}
                          autoFocus
                        />
                      </label>
                      <label className="form-field">
                        <span>Usuario de acceso</span>
                        <input
                          type="text"
                          value={usuarioEdicion}
                          onChange={(e) => setUsuarioEdicion(e.target.value)}
                          disabled={guardandoDatos}
                        />
                      </label>
                      <label className="form-field">
                        <span>Categoría laboral</span>
                        <select value={rolEdicion} onChange={(e) => setRolEdicion(e.target.value)} disabled={guardandoDatos}>
                          {Object.entries(ROL_LABELS).map(([key, label]) => (
                            <option key={key} value={key}>{label}</option>
                          ))}
                          <option value="__otra__">Otra categoría…</option>
                        </select>
                      </label>
                      {rolEdicion === "__otra__" && (
                        <label className="form-field">
                          <span>Nombre de la categoría</span>
                          <input
                            type="text"
                            value={rolPersonalizadoEdicion}
                            onChange={(e) => setRolPersonalizadoEdicion(e.target.value)}
                            disabled={guardandoDatos}
                          />
                        </label>
                      )}
                    </div>
                    <div className="usuarios-inline-actions">
                      <button
                        className="btn"
                        type="button"
                        disabled={guardandoDatos}
                        onClick={() => cancelEdit(setEditandoDatos)}
                      >
                        Cancelar
                      </button>
                      <button
                        className="btn primary"
                        type="button"
                        disabled={guardandoDatos}
                        onClick={() => guardarDatos(usuarioAdministrado)}
                      >
                        {guardandoDatos ? "Guardando..." : "Guardar cambios"}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="usuarios-detail-grid">
                    <div>
                      <span>Nombre</span>
                      <strong>{usuarioAdministrado.nombre}</strong>
                    </div>
                    <div>
                      <span>Usuario</span>
                      <strong>{usuarioAdministrado.usuario}</strong>
                    </div>
                    <div>
                      <span>Categoría</span>
                      <strong>{getRolLabel(usuarioAdministrado.rol)}</strong>
                    </div>
                    <div>
                      <span>Estado</span>
                      <strong className="status-ready">{usuarioAdministrado.activo === false ? "Inactivo" : "Activo"}</strong>
                    </div>
                  </div>
                )}
              </section>

              <section className="usuarios-panel-section">
                <div className="usuarios-panel-section-title">
                  <div>
                    <strong>Correo de avisos</strong>
                    <span>Solo para avisos, no para iniciar sesión</span>
                  </div>
                  {!editandoCorreo && (
                    <button className="btn" type="button" onClick={iniciarEdicionCorreo}>
                      {usuarioAdministrado.email_notificaciones ? "Cambiar" : "Agregar"}
                    </button>
                  )}
                </div>

                {editandoCorreo ? (
                  <div className="usuarios-email-editor">
                    <label className="form-field">
                      <span>Correo de notificaciones</span>
                      <input
                        type="email"
                        value={correoEdicion}
                        placeholder="nombre@gmail.com"
                        onChange={(e) => setCorreoEdicion(e.target.value)}
                        autoFocus
                      />
                    </label>
                    <div className="usuarios-inline-actions">
                      <button
                        className="btn"
                        type="button"
                        disabled={guardandoCorreo}
                        onClick={() => cancelEdit(setEditandoCorreo)}
                      >
                        Cancelar
                      </button>
                      <button
                        className="btn primary"
                        type="button"
                        disabled={guardandoCorreo}
                        onClick={() => guardarCorreo(usuarioAdministrado)}
                      >
                        {guardandoCorreo ? "Guardando..." : "Guardar correo"}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className={`usuarios-notification-card ${usuarioAdministrado.email_notificaciones ? "is-ready" : "is-pending"}`}>
                    <i className={`usuarios-dot ${usuarioAdministrado.email_notificaciones ? "is-ready" : "is-pending"}`} />
                    <div>
                      <strong>
                        {usuarioAdministrado.email_notificaciones || "Correo pendiente de configurar"}
                      </strong>
                      <span>
                        {usuarioAdministrado.email_notificaciones
                          ? "Esta persona puede recibir avisos de tareas."
                          : "Esta persona todavía no recibirá avisos por email."}
                      </span>
                    </div>
                  </div>
                )}
              </section>

              <section className="usuarios-panel-section">
                <div className="usuarios-panel-section-title">
                  <div>
                    <strong>Acceso con Google</strong>
                    <span>Email de acceso configurado explícitamente por un administrador</span>
                  </div>
                  {!editandoGoogleEmail && (
                    <button className="btn" type="button" onClick={iniciarEdicionGoogleEmail}>
                      {usuarioAdministrado.google_email ? "Cambiar" : "Vincular"}
                    </button>
                  )}
                </div>

                {editandoGoogleEmail ? (
                  <div className="usuarios-email-editor">
                    <label className="form-field">
                      <span>Email de Google para acceso</span>
                      <input
                        type="email"
                        value={googleEmailEdicion}
                        placeholder="nombre@gmail.com"
                        onChange={(e) => setGoogleEmailEdicion(e.target.value)}
                        autoFocus
                      />
                    </label>
                    <div className="usuarios-inline-actions">
                      <button
                        className="btn"
                        type="button"
                        disabled={guardandoGoogleEmail}
                        onClick={() => cancelEdit(setEditandoGoogleEmail)}
                      >
                        Cancelar
                      </button>
                      <button
                        className="btn primary"
                        type="button"
                        disabled={guardandoGoogleEmail}
                        onClick={() => guardarGoogleEmail(usuarioAdministrado)}
                      >
                        {guardandoGoogleEmail ? "Guardando..." : "Guardar email"}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className={`usuarios-notification-card ${usuarioAdministrado.google_email ? "is-ready" : "is-pending"}`}>
                    <i className={`usuarios-dot ${usuarioAdministrado.google_email ? "is-ready" : "is-pending"}`} />
                    <div>
                      <strong>
                        {usuarioAdministrado.google_email || "Email de Google sin vincular"}
                      </strong>
                      <span>
                        {usuarioAdministrado.google_email
                          ? "Puede ingresar con Google o usar su usuario de acceso o este email con contraseña. El correo de avisos no habilita el acceso."
                          : "Ingresá con el usuario de acceso y contraseña. El correo de avisos no habilita el acceso con Google ni con contraseña."}
                      </span>
                    </div>
                  </div>
                )}
              </section>

              <section className="usuarios-panel-section">
                <div className="usuarios-panel-section-title">
                  <div>
                    <strong>Enviar acceso</strong>
                    <span>Instrucciones para iniciar sesión</span>
                  </div>
                  <button
                    className="btn primary"
                    type="button"
                    disabled={!usuarioAdministrado.email_notificaciones || enviandoInvitacion}
                    onClick={() => enviarInvitacion(usuarioAdministrado)}
                  >
                    {enviandoInvitacion ? "Enviando..." : "Enviar instrucciones"}
                  </button>
                </div>
                <div className="usuarios-security-note">
                  La contraseña no se muestra. Cada persona puede cambiarla
                  desde <strong>Mi perfil</strong>.
                </div>
              </section>

              <section className="usuarios-panel-section usuarios-danger-zone">
                <div>
                  <strong>{usuarioAdministrado.activo === false ? "Reactivar el acceso" : "Dar de baja el acceso"}</strong>
                  <span>{usuarioAdministrado.activo === false ? "La persona podrá volver a ingresar a la plataforma." : "La persona dejará de ingresar; sus asignaciones e historial se conservarán."}</span>
                </div>
                <button
                  className="btn usuarios-danger-btn"
                  type="button"
                  onClick={() => handleEliminar(usuarioAdministrado)}
                >
                  {usuarioAdministrado.activo === false ? "Reactivar acceso" : "Dar de baja"}
                </button>
              </section>
            </fieldset>
          </aside>
        </div>
      )}
    </main>
  );
}
