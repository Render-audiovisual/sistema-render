import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { FilterSelect } from '../components/FilterSelect.jsx';
import { getRolLabel } from "../constants.js";
import { esperandoMaterial, extraerUrlsTarea, getTipoPublicacionLabel, obtenerInfoLinkTarea, renderizarTextoTarea, getSesion } from "../utils.jsx";
import { AREAS, BOARD_COLUMNS, STATUSES, TASK_TYPES, canonicalTaskState, isTaskCompleted } from "../features/render-os/constants.js";
import { apiJson, apiRequest, apiTaskById, apiTaskPage } from "../features/render-os/services/render-os-api.js";
import { areaForTask, emojiForTaskCard, formatDate, formatDateTime, initials, personForTask, taskResponsibleLabels } from "../features/render-os/utils/task-formatters.js";
import { canRetryTaskUpdate, canUserDeleteTask, canUserEditTask, canUserMoveTask, canUserMoveTaskToState, mergeRelatedTasks } from "../workspace-task-state.js";
import { effectiveTaskFilterState, getTasksEmptyMessage, getTaskViewState, isNewTaskDraftDirty, taskMatchesReviewScope, taskQueryNotice, writeTaskViewUrl } from "../features/render-os/utils/task-view-state.js";
import { buildResponsibleOptions, resolveResponsibleFilter, taskMatchesResponsible } from "../features/render-os/utils/task-responsible-filter.js";
import { groupTasksByResponsible, groupTasksByClient } from "../features/render-os/utils/task-groups.js";
import { createTaskManualOrder, taskOrderArrowAnchor } from "../features/render-os/utils/task-manual-order.js";
import { taskVisibleWindow } from '../features/render-os/utils/task-visible-window.js';
import { getProductionPhase, getProductionVisitProgress, isProductionVisitTask } from "../features/render-os/utils/production-visits.js";
import { getCanonicalTaskContentMetadata, getUnifiedTaskContent, isLinkedProductionEditorialTask } from "../features/render-os/utils/task-content.js";
import { getTaskContentPresentation } from "../features/render-os/utils/task-content-presentation.js";
import { insertTaskContentBlock } from "../features/render-os/utils/task-content-insertion.js";
import { getNewTaskSuggestions, getTaskDirectUrl } from "../features/render-os/utils/new-task-suggestions.js";
import { getHoyLocalISO } from "../shared/date/date-utils.js";
import { buildTaskAssignmentInput } from "../shared/task-assignment-input.js";
import { markFeedbackSeen, readFeedbackSeenAt } from "../features/render-os/utils/feedback-notifications.js";
import { DriveUploader } from "../features/drive/DriveUploader.jsx";
import { useTaskBoardMotion } from "../features/render-os/useTaskBoardMotion.js";
import { useTaskWindowMotion } from "../features/render-os/useTaskWindowMotion.js";
import { useMediaQuery } from "../features/render-os/useMediaQuery.js";
import { GoalTaskLink } from "../features/render-os/GoalTaskLink.jsx";
import { isTaskEditorialContext } from '../features/render-os/utils/task-editorial-context.js';
import { EditingDeliveries } from "../components/EditingDeliveries.jsx";
import { EditingReviews } from "../components/EditingReviews.jsx";
import { TaskRecordedContext } from "../components/TaskRecordedContext.jsx";
import { TaskCoordination } from "../components/TaskCoordination.jsx";
import { ProductionReconciliation } from "../components/ProductionReconciliation.jsx";
import { DiscardChangesDialog } from "../components/DiscardChangesDialog.jsx";
import { refreshEditingTask } from "../components/editingTaskRefresh.js";
import { useNavigationGuard } from "../shared/navigation/useNavigationGuard.js";
import { navigateWithinApp, requestAppNavigation } from "../shared/navigation/location.js";
import { isTaskDraftDirty, keepsTaskOpen } from "./taskNavigationGuard.js";
import { mergeTaskComments } from './taskCommentCollection.js';
import { createTaskCommentCreation } from './taskCommentCreation.js';
import {createTaskCreationAttempt,parseTaskCreationAck} from './taskCreationAttempt.js';
import { createCapturedRequest, isSessionFailure } from '../shared/session/captured-request.js';
import { useSessionView } from '../shared/session/use-session-view.js';
import "./WorkspaceReadOnly.css";
import "./TaskDetailCompact.css";
import "./RenderApplePolish.css";
import "./TaskHeader.css";
import "./TaskBoardMotion.css";
import "./TaskDetailNotion.css";

function useWorkspaceCapture(sesion) {
  const view = useSessionView(sesion);
  const live = useRef(view);
  live.current = view;
  const mounted = useRef(false);
  // Parent scopes must be live before child passive effects request subtasks.
  useLayoutEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  return useCallback((request = apiRequest) => createCapturedRequest({
    session: view.session, readSession: getSesion, request,
    isActive: () => mounted.current && live.current === view,
  }), [view]);
}

function Avatar({ person, name }) {
  const label = person?.nombre || name || "Sin asignar";
  return <span className="ros-avatar" title={person ? `${person.nombre} · @${person.usuario}` : label}>{initials(label)}</span>;
}

function taskResponsibles(task = {}, users = []) {
  return taskResponsibleLabels(task, users);
}

function taskResponsiblesLabel(task = {}, users = []) {
  const names = taskResponsibles(task, users);
  return names.length ? names.join(", ") : "Sin responsables";
}

function AreaBadge({ task, card = false }) {
  const resolvedArea = AREAS.find((item) => item.id === areaForTask(task)) || AREAS[0];
  const emoji = card ? emojiForTaskCard(task) : "";
  const area = card && emoji === "📌" ? { label: "General", icon: "•", color: "#68717f" } : resolvedArea;
  return <span className="ros-area-badge" style={{ "--area": area.color }}>{card ? <span className="ros-area-emoji" aria-hidden="true">{emoji}</span> : area.icon} {area.label}</span>;
}

function TaskViewIcon({ name }) {
  const paths = {
    board: <><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></>,
    list: <><path d="M8 6h13M8 12h13M8 18h13"/><circle cx="4" cy="6" r="1"/><circle cx="4" cy="12" r="1"/><circle cx="4" cy="18" r="1"/></>,
    calendar: <><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/></>,
    clients: <><circle cx="9" cy="8" r="3"/><path d="M3.5 20c.5-4 2.4-6 5.5-6s5 2 5.5 6M16 7.5a3 3 0 0 1 0 5.5M16.5 15c2.4.3 3.8 2 4 5"/></>,
    feedback: <><path d="M5 4h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-5 3v-5a2 2 0 0 1-1-2V6a2 2 0 0 1 2-2Z"/><path d="M7 9h10M7 13h7"/></>,
    plus: <path d="M12 5v14M5 12h14"/>,
  };
  return <svg className="ros-ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

function LoadingState({ error, onRetry }) {
  return <div className={`ros-state ${error ? "error" : ""}`}><span>{error ? "!" : "◌"}</span><strong>{error || "Conectando con los datos reales…"}</strong><small>{error ? "No pudimos cargar las tareas. Podés reintentar sin salir del tablero." : "Cargando tareas, clientes y responsables."}</small>{error && <button type="button" onClick={onRetry}>Reintentar</button>}</div>;
}

function Toast({ toast, onClose }) {
  if (!toast) return null;
  return <button type="button" className={`ros-toast ${toast.type || "success"}`} onClick={onClose}><span>{toast.type === "error" ? "!" : "✓"}</span>{toast.message}</button>;
}

function TaskContentWorkspace({ task, metadata, editing, draft, setDraft, editorRef, onInsertTemplate, onEditContent, onCancelEdit, onSaveEdit, saving, canSave }) {
  const preserveEditorialCopy = isLinkedProductionEditorialTask(task);
  const presentation = getTaskContentPresentation(task);
  const editorialCopy = typeof metadata.copy_trabajo === "string" ? metadata.copy_trabajo : "";
  const savedContent = getUnifiedTaskContent(task);
  const value = editing && String(draft.aclaraciones || "") !== String(task.aclaraciones || "") ? String(draft.aclaraciones || "") : savedContent;
  return <section className="ros-work-block ros-content-workspace">
    <div className="ros-block-heading"><div><h3>Brief · Contenido de trabajo</h3></div><small>{presentation.description}</small></div>
    {editing ? <div className="ros-content-editor">
      <div className="ros-content-editor-header"><div><span>Documento de trabajo</span><strong>Escribí todo lo necesario para resolver la tarea</strong></div></div>
      <div className="ros-content-tools"><span>Usá bloques para ordenar el texto.</span>{presentation.templates.map((template) => <button type="button" key={`${template.label}-${template.value}`} onClick={() => onInsertTemplate(template.value)}>{template.label}</button>)}</div>
      <textarea ref={editorRef} className="ros-detail-textarea ros-content-textarea" aria-label="Brief · Contenido de trabajo" rows={16} value={value} placeholder={presentation.placeholder} onChange={(event) => setDraft({ ...draft, aclaraciones: event.target.value })}/>
      <div className="ros-content-edit-actions"><small>Guardá antes de cerrar la tarea.</small><div><button type="button" onClick={onCancelEdit}>Cancelar</button><button className="primary" type="button" disabled={saving || !canSave} onClick={onSaveEdit}>{saving ? "Guardando…" : "Guardar texto"}</button></div></div>
    </div> : value ? <div className={`ros-content-editor ros-content-viewer ${onEditContent ? "is-editable" : ""}`} role={onEditContent ? "button" : undefined} tabIndex={onEditContent ? 0 : undefined} onClick={onEditContent || undefined} onKeyDown={onEditContent ? (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onEditContent(); } } : undefined}><div className="ros-content-editor-header"><div><span>Contenido de la tarea</span><strong>Información para trabajar</strong></div>{onEditContent && <b>Hacé clic para editar</b>}</div><div className="ros-content-reading">{renderizarTextoTarea(value)}</div></div> : <div className="ros-content-empty"><span>✎</span><div><strong>Todavía no hay contenido cargado.</strong><p>{presentation.empty}</p></div>{onEditContent && <button type="button" onClick={onEditContent}>Escribir contenido</button>}</div>}
    {preserveEditorialCopy && <aside aria-label="Copy editorial"><h4>Copy editorial</h4>{editorialCopy.trim() ? <div className="ros-content-reading">{renderizarTextoTarea(editorialCopy)}</div> : <p>El copy editorial se gestiona en la pieza vinculada.</p>}</aside>}
  </section>;
}

function taskProductionRegistryState(task, lookup) {
  const key = `${task.id}:${task.revision ?? task.updated_at ?? ""}`;
  const ready = lookup.key === key && lookup.status === "ready";
  const vinculo = ready ? lookup.vinculo : null;
  // Routing authority is the canonical origin, not whether its first video
  // has been entered. Keep the reporting artifact flag itself unchanged.
  const usesIndividual=vinculo?.tipo==='origen'||vinculo?.usa_registro_individual===true;
  return { ready, vinculo, usesIndividual,
    legacyEnabled: ready && !vinculo,
    clientEditable: ready && !vinculo,
    dateEditable: ready && vinculo?.tipo !== "origen" };
}

function TaskDetail({ task, tasks, users, clients, sesion, onClose, onOpen, onLoadSubtasks, onUpdate, onRegisterProduction, onCorrectProduction, onConfirmProduction, onApprove, onTrashAction, reviewRequestedTaskId = null }) {
  const captureRequest = useWorkspaceCapture(sesion);
  const windowMotion = useTaskWindowMotion(task?.id, onClose);
  const [editing, setEditing] = useState(false);
  const [deliveryFormDirty, setDeliveryDirty] = useState(false);
  const [deliveryFormBusy, setDeliveryBusy] = useState(false);
  const [reviewDecisionDirty, setReviewDecisionDirty] = useState(false);
  const [reviewDecisionBusy, setReviewDecisionBusy] = useState(false);
  const deliveryDirty = deliveryFormDirty || reviewDecisionDirty;
  const deliveryBusy = deliveryFormBusy || reviewDecisionBusy;
  const [editingReview, setEditingReview] = useState(null);
  const [reviewAcknowledged, setReviewAcknowledged] = useState(false);
  const [reviewRefreshing, setReviewRefreshing] = useState(false);
  const [reviewError, setReviewError] = useState('');
  useEffect(() => { setReviewAcknowledged(false); }, [task?.id, task?.revision, captureRequest, editingReview?.latestDelivery?.id, editingReview?.task?.revision]);
  const [draft, setDraftState] = useState(() => task ? { ...task, aclaraciones: getUnifiedTaskContent(task) } : {});
  const draftSourceRef = useRef(task);
  const briefDraftOwner = useRef(null);
  if (!briefDraftOwner.current || briefDraftOwner.current.taskId !== task?.id || briefDraftOwner.current.captureRequest !== captureRequest) {
    briefDraftOwner.current = { taskId: task?.id, captureRequest, baseline: task ? JSON.parse(JSON.stringify(task)) : null, generation: 0, pending: null, initialized: false };
  }
  const [briefError, setBriefError] = useState('');
  const setDraft = (owner => update => {
    if (briefDraftOwner.current !== owner) return;
    owner.generation++;
    setDraftState(update);
  })(briefDraftOwner.current);
  const [comments, setComments] = useState([]);
  const [comment, setComment] = useState("");
  const [, renderCommentCreation] = useState(0);
  const [, renderCommentRead] = useState(0);
  const commentDraftOwner = useRef(null);
  if (!commentDraftOwner.current || commentDraftOwner.current.taskId !== task?.id || commentDraftOwner.current.captureRequest !== captureRequest) {
    const owner = { taskId: task?.id, captureRequest, generation: 0, readGeneration: 0, refresh: null, readError: '', initialized: false, consumed: null, commentsRead: { items: [], confirmed: [] } };
    commentDraftOwner.current = owner;
    owner.creation = createTaskCommentCreation({
      capture: () => {
        const guard = captureRequest();
        return { current: () => commentDraftOwner.current === owner && guard.current(), request: guard.request.bind(guard) };
      },
      onState: state => {
        if (commentDraftOwner.current !== owner) return;
        setCommenting(state.busy); setCommentError(state.error); renderCommentCreation(value => value + 1);
      },
    });
  }
  const [commentError, setCommentError] = useState("");
  const [saving, setSaving] = useState(false);
  const [commenting, setCommenting] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [productionAmount, setProductionAmount] = useState(1);
  const [productionDate, setProductionDate] = useState(getHoyLocalISO());
  const [productionCorrections, setProductionCorrections] = useState({});
  const [productionDriveLink, setProductionDriveLink] = useState(task?.material_referencia || "");
  const [registeringProduction, setRegisteringProduction] = useState(false);
  const [savingProductionDrive, setSavingProductionDrive] = useState(false);
  const [approving, setApproving] = useState(false);
  const approvalPendingRef = useRef(false);
  const [publicationResponsible, setPublicationResponsible] = useState(null);
  const [confirmingProduction, setConfirmingProduction] = useState(false);
  const [coordinationDraft, setCoordinationDraft] = useState({ dirty: false, busy: false });
  const [reconciliationDraft, setReconciliationDraft] = useState({ dirty: false, busy: false });
  const [discardDialogOpen, setDiscardDialogOpen] = useState(false);
  const [registryLookup, setRegistryLookup] = useState({ status: "loading", key: null, vinculo: null });
  const [registryRetry, setRegistryRetry] = useState(0);
  const [linkCopied, setLinkCopied] = useState(false);
  const archivePendingRef = useRef(false);
  const closeApprovedRef = useRef(false);
  const taskDraftDirty = isTaskDraftDirty(task, draft) || Boolean(comment.trim()) || deliveryDirty || coordinationDraft.dirty || reconciliationDraft.dirty
    || (isProductionVisitTask(task || {}) && productionDriveLink.trim() !== String(task?.material_referencia || '').trim())
    || commentDraftOwner.current.creation.snapshot.locked;
  const taskWriteBusy = saving || commenting || archiving || registeringProduction || savingProductionDrive || approving || confirmingProduction || deliveryBusy || coordinationDraft.busy || reconciliationDraft.busy;
  useNavigationGuard(({ to, type }) => discardDialogOpen ? { dirty: taskDraftDirty, busy: true } : type !== 'refresh' && (closeApprovedRef.current || keepsTaskOpen(to, task?.id))
    ? { dirty: false, busy: false }
    : { dirty: taskDraftDirty || commentDraftOwner.current.creation.snapshot.locked, busy: taskWriteBusy || commentDraftOwner.current.creation.snapshot.busy || archivePendingRef.current || discardDialogOpen });
  const scriptEditorRef = useRef(null);
  const deliverySectionRef = useRef(null);
  async function refreshEditingTaskAfterSave(_result, isCurrent) {
    const guard = captureRequest();
    await refreshEditingTask({ taskId: task.id, request: (id, options) => guard.request(`/api/tareas/${id}?workspace=render_os`, options),
      onRefreshed: refreshed => { guard.assertCurrent(); window.dispatchEvent(new CustomEvent("render-os:related-tasks", { detail: [refreshed] })); } }, () => guard.current() && isCurrent());
  }
  async function refreshUploadedTask(_uploaded, uploadScope) {
    uploadScope.assertCurrent();
    const refreshed = await apiTaskById(task.id, uploadScope.options());
    uploadScope.assertCurrent();
    window.dispatchEvent(new CustomEvent("render-os:related-tasks", { detail: [refreshed] }));
  }
  const isAdmin = Number.isSafeInteger(sesion?.usuario?.id) && sesion.usuario.id > 0 && sesion.usuario.rol === "admin";

  useEffect(() => {
    if (!task) return;
    const controller = new AbortController();
    const guard = captureRequest();
    const key = `${task.id}:${task.revision ?? task.updated_at ?? ""}`;
    let refreshQueued = false;
    const refreshRegistry = () => {
      if (!guard.current() || document.visibilityState !== "visible" || refreshQueued) return;
      refreshQueued = true;
      controller.abort();
      setRegistryLookup({status:"loading", key, vinculo:null});
      setRegistryRetry(value => value + 1);
    };
    window.addEventListener("focus", refreshRegistry);
    document.addEventListener("visibilitychange", refreshRegistry);
    setRegistryLookup({status:"loading", key, vinculo:null});
    guard.request(`/api/producciones/tareas/${task.id}`, {signal:controller.signal})
      .then(data => {
        if (!Object.hasOwn(data, "vinculo") || (data.vinculo !== null &&
          (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(data.vinculo.id) ||
           !["origen", "edicion"].includes(data.vinculo.tipo) || typeof data.vinculo.usa_registro_individual !== "boolean"))) {
          throw new Error("La respuesta del vínculo de producción no es válida.");
        }
        if (guard.current() && !controller.signal.aborted) setRegistryLookup({status:"ready", key, vinculo:data.vinculo});
      })
      .catch(reason => { if (guard.current() && !controller.signal.aborted) setRegistryLookup({status:"error", key, vinculo:null, error:reason.message}); });
    return () => {
      controller.abort();
      window.removeEventListener("focus", refreshRegistry);
      document.removeEventListener("visibilitychange", refreshRegistry);
    };
  }, [task?.id, task?.revision, task?.updated_at, registryRetry, captureRequest]);

  useEffect(() => {
    if (!task) return;
    const controller = new AbortController();
    const guard = captureRequest(apiJson);
    const owner = commentDraftOwner.current, readGeneration = ++owner.readGeneration;
    owner.refresh = null; owner.readError = '';
    const commentsRead = { items: [], confirmed: [...owner.commentsRead.confirmed] }; owner.commentsRead = commentsRead;
    const currentComments = () => guard.current() && !controller.signal.aborted
      && commentDraftOwner.current === owner && owner.readGeneration === readGeneration && owner.commentsRead === commentsRead;
    if (!briefDraftOwner.current.initialized) {
      briefDraftOwner.current.initialized = true;
      setDraft({ ...task, aclaraciones: getUnifiedTaskContent(task) });
      setEditing(false); setBriefError(''); setSaving(false);
    }
    if (!owner.initialized) {
      owner.initialized = true; owner.generation++; setComment("");
    }
    setCommenting(owner.creation.snapshot.busy);
    setCommentError(owner.creation.snapshot.error);
    setComments([]);
    if (commentsRead.confirmed.length) setComments(commentsRead.confirmed);
    setLinkCopied(false);
    setProductionAmount(1);
    setProductionDate(getHoyLocalISO());
    setProductionCorrections({});
    setProductionDriveLink(task.material_referencia || "");
    setPublicationResponsible(task.responsable_publicacion_id ?? task.propiedades_extra?.responsable_publicacion_id ?? null);
    guard.request(`/api/tareas/${task.id}/comentarios?workspace=render_os`, { signal: controller.signal })
      .then(items => {
        if (!currentComments()) return;
        const merged = mergeTaskComments(items, commentsRead.confirmed, owner.taskId);
        commentsRead.items = merged; setComments(merged);
      })
      .catch((reason) => {
        if (currentComments()) { owner.readError = reason.message || "No se pudieron cargar los comentarios."; renderCommentRead(value => value + 1); }
      });
    onLoadSubtasks(task.id, { signal: controller.signal }).catch((reason) => {
      if (guard.current() && !controller.signal.aborted) setCommentError(reason.message || "No se pudieron cargar las subtareas.");
    });
    return () => controller.abort();
  }, [task?.id, onLoadSubtasks, captureRequest]);

  useEffect(() => {
    if (!task) return;
    draftSourceRef.current = task;
    const owner = briefDraftOwner.current;
    // Remote reads may update the task, never the observation of a dirty brief.
    if (owner.pending || editing || isTaskDraftDirty(owner.baseline, draft)) return;
    if (task.revision < owner.baseline?.revision) return;
    owner.baseline = JSON.parse(JSON.stringify(task));
    setDraft({ ...task, aclaraciones: getUnifiedTaskContent(task) });
  }, [task?.updated_at, task?.revision]);

  useEffect(() => {
    if (!task) return undefined;
    const previous = document.body.style.overflow;
    const previousFocus = document.activeElement;
    const backgroundRegions = [
      document.querySelector(".render-workspace .ros-page"),
      document.querySelector('[aria-label="Navegación principal"]'),
    ].filter(Boolean);
    const backgroundState = backgroundRegions.map((element) => ({
      element,
      inert: element.inert,
      ariaHidden: element.getAttribute("aria-hidden"),
    }));
    document.body.style.overflow = "hidden";
    backgroundRegions.forEach((element) => {
      element.inert = true;
      element.setAttribute("aria-hidden", "true");
    });
    const focusFrame = window.requestAnimationFrame(() => windowMotion.panelRef.current?.focus({ preventScroll: true }));
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.body.style.overflow = previous;
      backgroundState.forEach(({ element, inert, ariaHidden }) => {
        element.inert = inert;
        if (ariaHidden === null) element.removeAttribute("aria-hidden");
        else element.setAttribute("aria-hidden", ariaHidden);
      });
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, [task?.id]);

  if (!task) return null;
  const status = STATUSES.find((item) => item.id === effectiveTaskFilterState(task)) || { label: task.estado, color: "#777" };
  const metadata = task.propiedades_extra || {};
  const driveFiles = Array.isArray(metadata.drive_archivos) ? metadata.drive_archivos : [];
  const isProductionVisit = isProductionVisitTask(task);
  const registry = taskProductionRegistryState(task, registryLookup);
  const legacyProductionEnabled = registry.legacyEnabled;
  const canEditVisitClient = registry.clientEditable;
  const canEditVisitDate = registry.dateEditable;
  const isLeader = isAdmin;
  const canChangeTaskState = canUserMoveTask(task, sesion?.usuario);
  const availableTaskStatuses = STATUSES.filter((item) => item.id === canonicalTaskState(task.estado) || canUserMoveTaskToState(task, sesion?.usuario, item.id));
  const canApproveForOriana = isLeader && task.estado === "en_revision";
  const editorialContext = isTaskEditorialContext(task);
  const usesEditingReview = task.tipo_tarea === 'edicion' && metadata.workspace === 'render_os';
  const editingReviewReady = editingReview?.status === 'ready' && editingReview.task?.id === task.id && editingReview.task?.revision === task.revision;
  const mayApproveObservedDelivery = !usesEditingReview || (!reviewRefreshing && editingReviewReady && (!editingReview.latestDelivery || reviewAcknowledged));
  const productionProgress = getProductionVisitProgress(task);
  const productionPhase = getProductionPhase(task);
  const canRegisterProduction = Number.isSafeInteger(sesion?.usuario?.id) && sesion.usuario.id > 0
    && canUserEditTask(task, sesion.usuario) && (isAdmin || sesion.usuario.rol === "produccion") && legacyProductionEnabled;
  const canConfirmProduction = legacyProductionEnabled && isLeader && isProductionVisit && productionProgress.complete && !metadata.produccion_confirmada_at;
  const isTrashed = metadata.papelera_render_os === true;
  const tags = Array.isArray(metadata.etiquetas) ? metadata.etiquetas : [];
  const collaborators = Array.isArray(metadata.colaboradores) ? metadata.colaboradores : [];
  const canEditTask = canUserEditTask(task, sesion?.usuario);
  const canDeleteTask = canUserDeleteTask(task, sesion?.usuario);
  const hasUnmappedAssignment = !Number.isSafeInteger(task.asignado_a_id) || task.asignado_a_id <= 0;
  const selectedPublisher = users.find((user) => user.id === publicationResponsible && ["admin", "community"].includes(user.rol));
  const assignedPeople = [task.asignado_a_id, ...(task.colaborador_ids || [])]
    .filter((id, index, ids) => Number.isSafeInteger(id) && id > 0 && ids.indexOf(id) === index)
    .map((id) => ({ id, person: users.find((user) => user.id === id) }));
  const subtasks = tasks.filter((item) => Number(item.tarea_padre_id) === Number(task.id));
  const links = [...new Set(extraerUrlsTarea(task.aclaraciones || ""))].filter((url) => url !== task.material_referencia);
  const materialInfo = task.material_referencia ? obtenerInfoLinkTarea(task.material_referencia) : null;
  const origin = task.historia_id
    ? { label: "Historia", date: task.historia_fecha_programada, state: task.historia_estado, href: "/planificacion-historias", calendarLabel: "Planificado en historias" }
    : task.publicacion_id
      ? { label: getTipoPublicacionLabel(task.publicacion_tipo), date: task.publicacion_fecha_programada, state: task.publicacion_estado, href: "/planificacion-publicaciones", calendarLabel: "Programado en el calendario" }
      : null;
  const teamComments = comments.filter((item) => !item.contenido.startsWith("[Actividad]"));
  const hasOperationalControls = esperandoMaterial(task)
    || (areaForTask(task) === "edicion" && canChangeTaskState && ["pendiente", "en_progreso"].includes(task.estado))
    || canApproveForOriana
    || (task.estado === "aprobada")
    || isProductionVisit;

  const save = (owner => async () => {
    const guard = captureRequest();
    const current = () => guard.current() && briefDraftOwner.current === owner && owner.taskId === task?.id && owner.captureRequest === captureRequest;
    if (!current() || owner.pending || saving || !canEditTask) return;
    const baseline = owner.baseline, generation = owner.generation;
    if (!Number.isSafeInteger(baseline?.revision) || baseline.revision < 1) {
      setBriefError('Falta la revisión original del borrador. Conservamos el texto; cancelá para cargar la versión actual antes de editar de nuevo.'); return;
    }
    const pending = {}; owner.pending = pending;
    setSaving(true);
    setBriefError('');
    const preserveEditorialCopy = isLinkedProductionEditorialTask(baseline);
    const fields = ["titulo", "cliente_id", "estado", "fecha_vencimiento", "prioridad", "tipo_tarea", "subtipo", "aclaraciones", "material_referencia"];
    const nullable = ["cliente_id", "fecha_vencimiento", "tipo_tarea", "subtipo", "aclaraciones", "material_referencia"];
    const changes = Object.fromEntries(fields
      .filter((field) => (field !== "cliente_id" || canEditVisitClient) && (field !== "fecha_vencimiento" || canEditVisitDate))
      .filter((field) => field === "estado"
        ? canonicalTaskState(draft.estado) !== canonicalTaskState(baseline.estado)
        : String(draft[field] ?? "") !== String(baseline[field] ?? ""))
      .map((field) => [field, draft[field] === "" && nullable.includes(field) ? null : draft[field]]));
    const nextMetadata = getCanonicalTaskContentMetadata({
      resumen: String(draft.resumen ?? metadata.resumen ?? "").trim(),
      etiquetas: draft.etiquetas === undefined ? tags : String(draft.etiquetas || "").split(",").map((item) => item.trim()).filter(Boolean),
      colaboradores: Array.isArray(draft.colaboradores) ? draft.colaboradores : collaborators,
    }, { preserveEditorialCopy });
    if (isProductionVisit && legacyProductionEnabled) nextMetadata.produccion_videos_previstos = draft.produccion_videos_previstos === undefined ? productionProgress.planned : Math.max(0, Number(draft.produccion_videos_previstos) || 0);
    const previousEditableMetadata = { resumen: metadata.resumen || "", etiquetas: tags, colaboradores: collaborators, guiones: metadata.guiones || "" };
    if (!preserveEditorialCopy) previousEditableMetadata.copy_trabajo = metadata.copy_trabajo || "";
    if (isProductionVisit && legacyProductionEnabled) previousEditableMetadata.produccion_videos_previstos = productionProgress.planned;
    if (JSON.stringify(nextMetadata) !== JSON.stringify(previousEditableMetadata)) {
      changes.propiedades_extra = nextMetadata;
    }
    try {
      if (changes.estado && !canUserMoveTaskToState(task, sesion?.usuario, changes.estado)) throw new Error("Transición no permitida.");
      if (changes.estado === "aprobada") {
        setReviewError('Para aprobar, revisá la versión y usá “Aprobar revisión”. Conservamos los cambios sin guardar.');
        return; // Never approve implicitly or persist the rest of a mixed draft.
      }
      guard.assertCurrent();
      const confirmed = Object.keys(changes).length
        ? await onUpdate(task.id, JSON.parse(JSON.stringify(changes)), "editó los datos de la tarea", baseline.revision) : baseline;
      guard.assertCurrent();
      if (!current() || owner.pending !== pending) return;
      if (confirmed?.id !== owner.taskId || !Number.isSafeInteger(confirmed.revision) || confirmed.revision < baseline.revision
        || Object.keys(changes).length && confirmed.revision === baseline.revision) throw new Error('No se pudo verificar la versión guardada.');
      owner.baseline = JSON.parse(JSON.stringify(confirmed));
      if (owner.generation === generation) {
        setDraft({ ...confirmed, aclaraciones: getUnifiedTaskContent(confirmed) }); setEditing(false);
      }
    } catch (reason) {
      if (current()) setBriefError(reason?.status === 409
        ? 'La tarea cambió desde que empezaste este borrador. Conservamos tu texto y su revisión original. Copiá lo que necesites antes de Cancelar para cargar la versión actual y volver a editar.'
        : 'No se pudo confirmar el guardado del brief. Conservamos tu texto; revisá la tarea antes de volver a guardar.');
    } finally {
      if (current() && owner.pending === pending) { owner.pending = null; setSaving(false); }
    }
  })(briefDraftOwner.current);

  const saveInlineField = async (field, value, activity = "editó los datos de la tarea") => {
    const guard = captureRequest();
    if (!guard.current()) return;
    if (saving || (field === "estado" ? !canChangeTaskState : !canEditTask)) return;
    if ((field === "cliente_id" && !canEditVisitClient) || (field === "fecha_vencimiento" && !canEditVisitDate)) return;
    if (field === "estado" && (value === canonicalTaskState(task.estado) || !canUserMoveTaskToState(task, sesion?.usuario, value))) return;
    // Approval is a reviewed operation, not an ordinary inline state PATCH.
    // The same handler as the explicit button owns acknowledgment and delivery CAS.
    if (field === "estado" && value === "aprobada") { await approveForOriana(); return; }
    const nullable = ["cliente_id", "fecha_vencimiento", "tipo_tarea", "subtipo", "material_referencia"];
    const nextValue = value === "" && nullable.includes(field) ? null : value;
    if (String(nextValue ?? "") === String(task[field] ?? "")) return;
    setDraft((current) => ({ ...current, [field]: value }));
    setSaving(true);
    try {
      await onUpdate(task.id, { [field]: nextValue }, activity);
    } catch {
      if (guard.current()) setDraft((current) => ({ ...current, [field]: task[field] ?? "" }));
    } finally {
      if (guard.current()) setSaving(false);
    }
  };

  const saveInlinePeople = async ({ primary, collaborators: nextCollaborators, ownerId, collaboratorIds }) => {
    const guard = captureRequest();
    if (!guard.current()) return;
    if (!canEditTask || saving || !ownerId) return;
    const assignment = buildTaskAssignmentInput({ ownerId, collaboratorIds });
    const unchanged = ownerId === task.asignado_a_id && JSON.stringify(collaboratorIds) === JSON.stringify(task.colaborador_ids || []);
    if (unchanged) return;
    setDraft((current) => ({ ...current, ...assignment, asignado_a: primary, colaboradores: nextCollaborators }));
    setSaving(true);
    try {
      await onUpdate(task.id, {
        ...assignment,
      }, "actualizó los responsables de la tarea");
    } catch {
      if (guard.current()) setDraft((current) => ({ ...current, asignado_a_id: task.asignado_a_id, colaborador_ids: task.colaborador_ids, asignado_a: task.asignado_a, colaboradores }));
    } finally {
      if (guard.current()) setSaving(false);
    }
  };

  const cancelEditing = (owner => () => {
    if (briefDraftOwner.current !== owner || owner.taskId !== task?.id || owner.captureRequest !== captureRequest || !captureRequest().current() || owner.pending || saving) return;
    owner.baseline = JSON.parse(JSON.stringify(task));
    setDraft({ ...task, aclaraciones: getUnifiedTaskContent(task) });
    setEditing(false); setBriefError('');
  })(briefDraftOwner.current);

  const insertContentTemplate = (template) => {
    const textarea = scriptEditorRef.current;
    const savedContent = getUnifiedTaskContent(task);
    const current = String(draft.aclaraciones || "") !== String(task.aclaraciones || "") ? String(draft.aclaraciones || "") : savedContent;
    const start = textarea?.selectionStart ?? current.length;
    const end = textarea?.selectionEnd ?? current.length;
    const inserted = insertTaskContentBlock(current, template, start, end);
    setDraft({ ...draft, aclaraciones: inserted.value });
    requestAnimationFrame(() => {
      if (!textarea) return;
      textarea.focus();
      textarea.setSelectionRange(inserted.cursor, inserted.cursor);
    });
  };

  const closeDetail = () => {
    if (windowMotion.closing || taskWriteBusy || commentDraftOwner.current.creation.snapshot.busy || archivePendingRef.current || discardDialogOpen) return;
    if (taskDraftDirty || commentDraftOwner.current.creation.snapshot.locked) { setDiscardDialogOpen(true); return; }
    closeApprovedRef.current = true;
    windowMotion.close();
  };

  const discardDetail = () => {
    // Approval is explicit and current writes still take precedence over leaving.
    if (!discardDialogOpen || windowMotion.closing || taskWriteBusy || commentDraftOwner.current.creation.snapshot.busy || archivePendingRef.current) return;
    setDiscardDialogOpen(false);
    closeApprovedRef.current = true;
    windowMotion.close();
  };

  const acceptCommentCreation = owner => {
    if (commentDraftOwner.current !== owner) return;
    const state = owner.creation.snapshot;
    if (state.phase !== 'confirmed' || !state.comment || owner.consumed === state.comment) return;
    const commentsRead = owner.commentsRead;
    try {
      const confirmed = mergeTaskComments(commentsRead.confirmed, [state.comment], owner.taskId);
      const merged = mergeTaskComments(commentsRead.items, confirmed, owner.taskId);
      owner.consumed = state.comment;
      commentsRead.confirmed = confirmed; commentsRead.items = merged; setComments(merged);
      // The captured generation, not text equality, owns clearing (including ABA).
      if (owner.generation === state.attempt.generation) { owner.generation++; setComment(""); }
    } catch (reason) { setCommentError(reason.message); }
  };

  const addComment = (owner => async () => {
    if (commentDraftOwner.current !== owner || owner.taskId !== task?.id || owner.captureRequest !== captureRequest) return;
    if (!comment.trim() || owner.creation.snapshot.locked || owner.creation.snapshot.busy) return;
    const accepted = await owner.creation.start({ taskId: owner.taskId,
      autor: sesion?.usuario?.nombre || sesion?.usuario?.usuario || "Equipo RENDER",
      contenido: comment, generation: owner.generation, validateAuthor: sesion?.usuario?.rol === 'admin' });
    if (accepted) acceptCommentCreation(owner);
  })(commentDraftOwner.current);

  const verifyCommentCreation = (owner => async () => {
    if (commentDraftOwner.current !== owner || owner.taskId !== task?.id || owner.captureRequest !== captureRequest) return;
    if (await owner.creation.verify()) acceptCommentCreation(owner);
  })(commentDraftOwner.current);

  const refreshComments = (owner => async () => {
    if (commentDraftOwner.current !== owner || owner.taskId !== task?.id || owner.captureRequest !== captureRequest || owner.refresh) return;
    const guard = captureRequest(apiJson);
    if (!guard.current()) return;
    const commentsRead = owner.commentsRead, readGeneration = ++owner.readGeneration;
    const lease = {}; owner.refresh = lease; owner.readError = '';
    const current = () => guard.current() && commentDraftOwner.current === owner
      && owner.readGeneration === readGeneration && owner.commentsRead === commentsRead && owner.refresh === lease;
    renderCommentRead(value => value + 1);
    try {
      const items = await guard.request(`/api/tareas/${owner.taskId}/comentarios?workspace=render_os`, { method: 'GET', cache: 'no-store' });
      if (!current()) return;
      const merged = mergeTaskComments(items, commentsRead.confirmed, owner.taskId);
      commentsRead.items = merged; setComments(merged);
    } catch (reason) {
      if (current()) owner.readError = reason.message || 'No se pudieron actualizar los comentarios.';
    } finally {
      if (current()) { owner.refresh = null; renderCommentRead(value => value + 1); }
    }
  })(commentDraftOwner.current);

  const changeTrashState = async () => {
    const guard = captureRequest();
    if (!guard.current()) return;
    if (archivePendingRef.current) return;
    if (!isTrashed && !window.confirm("¿Enviar esta tarea a Papelera? Podrás restaurarla durante 10 días.")) return;
    archivePendingRef.current = true;
    setArchiving(true);
    try {
      await onTrashAction(task, isTrashed ? "restaurar" : "papelera");
    } finally {
      if (guard.current()) { archivePendingRef.current = false; setArchiving(false); }
    }
  };

  const registerProduction = async (finish = false) => {
    const guard = captureRequest();
    if (!guard.current()) return;
    if (!canRegisterProduction || registeringProduction || metadata.produccion_confirmada_at) return;
    setRegisteringProduction(true);
    try {
      await onRegisterProduction(task, Number(productionAmount), productionDate, finish);
      guard.assertCurrent();
      setProductionAmount(1);
    } catch {
      // The parent refreshes conflicts. Keep amount/date for an explicit resubmission.
    } finally {
      if (guard.current()) setRegisteringProduction(false);
    }
  };

  const confirmProduction = async () => {
    const guard = captureRequest();
    if (!guard.current()) return;
    if (!canConfirmProduction || confirmingProduction) return;
    setConfirmingProduction(true);
    try { await onConfirmProduction(task); }
    catch { /* The parent reports the conflict; no automatic confirmation retry. */ }
    finally { if (guard.current()) setConfirmingProduction(false); }
  };

  const correctProduction = async (record) => {
    const guard = captureRequest();
    if (!guard.current()) return;
    if (!canRegisterProduction) return;
    const value = window.prompt("Cantidad correcta de videos:", productionCorrections[record.id] ?? String(record.cantidad));
    if (value === null) return;
    if (!guard.current()) return;
    setProductionCorrections((current) => ({ ...current, [record.id]: value }));
    try {
      const updated = await onCorrectProduction(task, record, Number(value));
      guard.assertCurrent();
      if (updated) setProductionCorrections((current) => { const next = { ...current }; delete next[record.id]; return next; });
    } catch {
      // Keep the entered correction as the next prompt's default after refresh.
    }
  };

  const approveForOriana = async (withPublisher = false) => {
    const guard = captureRequest();
    if (!guard.current()) return false;
    if (!canApproveForOriana || approvalPendingRef.current || approving || saving || deliveryBusy || deliveryDirty || !mayApproveObservedDelivery || (withPublisher && (!isTaskEditorialContext(task) || !selectedPublisher))) return false;
    approvalPendingRef.current = true;
    setApproving(true);
    try { await onApprove(task, withPublisher ? selectedPublisher.id : undefined, usesEditingReview ? { revision: editingReview.task.revision, deliveryId: editingReview.latestDelivery?.id || null } : null); return true; }
    catch (error) { if (guard.current()) { setReviewAcknowledged(false); setReviewError(error.message || 'No se pudo aprobar. Actualizá la tarea y el historial antes de volver a revisar.'); } return false; }
    finally { approvalPendingRef.current = false; if (guard.current()) setApproving(false); }
  };

  const refreshReviewTask = async () => {
    if (reviewRefreshing || deliveryBusy || approving) return;
    const guard = captureRequest();
    if (!guard.current()) return;
    setReviewRefreshing(true); setReviewAcknowledged(false); setReviewError('');
    try {
      const refreshed = await guard.request(`/api/tareas/${task.id}?workspace=render_os`);
      guard.assertCurrent();
      window.dispatchEvent(new CustomEvent('render-os:related-tasks', { detail: [refreshed] }));
    } catch { if (guard.current()) setReviewError('No se pudo actualizar la tarea. Reintentá antes de aprobar.'); }
    finally { if (guard.current()) setReviewRefreshing(false); }
  };

  const saveProductionDrive = async () => {
    const guard = captureRequest();
    if (!guard.current()) return;
    const link = productionDriveLink.trim();
    if (!canRegisterProduction || !link || savingProductionDrive) return;
    setSavingProductionDrive(true);
    try { await onUpdate(task.id, { material_referencia: link }, "vinculó la carpeta de producción en Google Drive"); }
    finally { if (guard.current()) setSavingProductionDrive(false); }
  };

  const sendTaskToReview = async () => {
    const guard = captureRequest();
    if (!guard.current()) return;
    setSaving(true);
    try { await onUpdate(task.id, { estado: "en_revision" }, "envió la tarea a revisión sin registrar una entrega"); }
    finally { if (guard.current()) setSaving(false); }
  };

  const copyTaskLink = async () => {
    const guard = captureRequest();
    if (!guard.current()) return;
    const link = getTaskDirectUrl(window.location.origin, task.id);
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(link);
      } else {
        const input = document.createElement("textarea");
        input.value = link;
        input.style.position = "fixed";
        input.style.opacity = "0";
        document.body.appendChild(input);
        input.select();
        document.execCommand("copy");
        input.remove();
      }
      guard.assertCurrent();
      setLinkCopied(true);
      window.setTimeout(() => { if (guard.current()) setLinkCopied(false); }, 2200);
    } catch {
      if (guard.current()) window.prompt("Copiá el enlace de la tarea:", link);
    }
  };

  return <div ref={windowMotion.backdropRef} className="ros-drawer-backdrop" inert={windowMotion.closing} onClick={closeDetail}>
    <aside ref={windowMotion.panelRef} className="ros-drawer ros-task-workspace" role="dialog" aria-modal="true" aria-labelledby={`ros-task-title-${task.id}`} tabIndex={-1} onClick={(event) => event.stopPropagation()} onKeyDown={(event) => { if (event.key === 'Escape' && !event.defaultPrevented) { event.stopPropagation(); closeDetail(); } }}>
      <header className="ros-task-workspace-header">
        <button className="ros-task-back" type="button" aria-label="Volver al tablero" onClick={closeDetail}><span aria-hidden="true">←</span><b>Volver</b></button>
        <span className="ros-task-window-icon">✓</span>
        <div className="ros-task-window-title"><small>{task.cliente_nombre || "Sin cliente"}</small><strong>{task.titulo}</strong></div>
        <button className="ros-copy-task-link" type="button" aria-label="Copiar enlace de la tarea" title="Copiar enlace de la tarea" onClick={copyTaskLink}>{linkCopied ? "✓ Copiado" : "↗ Copiar enlace"}</button>
        <button type="button" aria-label="Cerrar tarea" onClick={closeDetail}>×</button>
      </header>
      <div className="ros-drawer-body ros-task-workspace-body">
        <div className="ros-task-layout">
          <main className="ros-task-main-column">
        <div className="ros-task-hero">
          <div className="ros-task-page-icon" aria-hidden="true">✓</div>
          <div className="ros-task-document-kind"><AreaBadge task={task}/><span>{task.cliente_nombre || "Sin cliente"}</span></div>
          <div className="ros-task-document-heading">{canEditTask ? <textarea id={`ros-task-title-${task.id}`} className="ros-title-input ros-inline-title-input" aria-label="Título de la tarea" rows={1} value={draft.titulo ?? task.titulo ?? ""} onChange={(event) => setDraft((current) => ({ ...current, titulo: event.target.value }))} onBlur={(event) => event.target.value.trim() ? saveInlineField("titulo", event.target.value.trim(), "actualizó el título de la tarea") : setDraft((current) => ({ ...current, titulo: task.titulo }))} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); event.currentTarget.blur(); } }}/> : <h2 id={`ros-task-title-${task.id}`}>{task.titulo}</h2>}</div>
          <div className="ros-task-hero-meta"><span>Tarea #{task.id}</span><span>Actualizada {formatDate(task.updated_at)}</span></div>
        </div>
        {task.cliente_id && <button className="ros-moodboard-link" type="button" onClick={() => {
          navigateWithinApp(window, `/moodboards?cliente=${task.cliente_id}&task=${task.id}`);
        }}>✦ Ver moodboard de {task.cliente_nombre || "la marca"}</button>}
        <div className="ros-task-document-properties">
          <div><span>◉ <b>Estado</b></span>{isAdmin || canChangeTaskState ? <select className="ros-inline-property" aria-label="Estado" value={canonicalTaskState(draft.estado ?? task.estado ?? "pendiente")} disabled={saving} onChange={(event) => saveInlineField("estado", event.target.value, "actualizó el estado de la tarea")}>{availableTaskStatuses.map((item) => <option key={item.id} value={item.id} disabled={isProductionVisit && item.id === "finalizada" && !productionProgress.complete}>{item.label}</option>)}</select> : <strong className="ros-task-document-status"><i style={{ background: status.color }}/>{status.label}</strong>}</div>
          <div className="ros-task-people-property is-inline-editing"><span>♙ <b>Responsables</b></span>{canEditTask ? <TaskPeoplePicker compact users={users} primaryId={draft.asignado_a_id ?? task.asignado_a_id ?? null} collaboratorIds={draft.colaborador_ids ?? task.colaborador_ids ?? []} disabled={saving} onChange={saveInlinePeople}/> : <strong className="ros-task-assignees">{assignedPeople.length ? assignedPeople.map(({ id, person }) => <span className="ros-task-assignee" key={id}><Avatar person={person} name={person?.nombre || `Usuario #${id}`}/><span>{person?.nombre || `Usuario #${id}`}<small>Responsable · #{id}</small></span></span>) : <span>{taskResponsiblesLabel(task, users)}</span>}</strong>}</div>
          <div><span>▥ <b>Cliente</b></span>{canEditTask && canEditVisitClient ? <select className="ros-inline-property" aria-label="Cliente" value={draft.cliente_id ?? task.cliente_id ?? ""} disabled={saving} onChange={(event) => saveInlineField("cliente_id", event.target.value ? Number(event.target.value) : "", "actualizó el cliente de la tarea")}><option value="">Sin cliente</option>{clients.map((client) => <option key={client.id} value={client.id}>{client.nombre}</option>)}</select> : <strong>{task.cliente_nombre || "Sin cliente"}</strong>}</div>
          <div><span>▦ <b>{registry.vinculo?.tipo === "origen" ? "Fecha de visita" : "Entrega"}</b></span>{canEditTask && canEditVisitDate ? <input className="ros-inline-property" aria-label="Fecha de entrega" type="date" value={draft.fecha_vencimiento ?? task.fecha_vencimiento ?? ""} disabled={saving} onChange={(event) => saveInlineField("fecha_vencimiento", event.target.value, "actualizó la fecha de entrega")}/> : <strong>{formatDate(task.fecha_vencimiento)}</strong>}</div>
          {(canEditTask || String(task.prioridad || "").toLowerCase() !== "media") && <div><span>⚑ <b>Prioridad</b></span>{canEditTask ? <select className="ros-inline-property" aria-label="Prioridad" value={draft.prioridad ?? task.prioridad ?? "media"} disabled={saving} onChange={(event) => saveInlineField("prioridad", event.target.value, "actualizó la prioridad de la tarea")}><option value="baja">Baja</option><option value="media">Media</option><option value="alta">Alta</option></select> : <strong>{task.prioridad || "Sin definir"}</strong>}</div>}
        </div>
        {hasUnmappedAssignment && <div className="ros-warning-banner" role="status">Asignación histórica sin vincular a un usuario. {isAdmin ? "Elegí responsables para asignarla explícitamente; no se vinculará por nombre." : "El nombre histórico no concede acceso de edición. Pedí a un administrador que asigne responsables."}</div>}
        <GoalTaskLink task={task} canManage={['admin', 'community'].includes(sesion?.usuario?.rol)}/>
        {!registry.ready && registryLookup.status !== "error" && <p role="status">Buscando visita de producción… Los controles de producción quedan bloqueados hasta verificar el vínculo.</p>}
        {!registry.ready && registryLookup.status === "error" && <div className="ros-warning-banner" role="alert">No se pudo verificar el vínculo de producción: {registryLookup.error}. No se habilitarán registros históricos sin verificarlo. <button type="button" onClick={() => setRegistryRetry(value => value + 1)}>Reintentar vínculo</button></div>}
        {registry.vinculo && <section className="ros-work-block"><h3>Visita vinculada</h3><p>{registry.vinculo.videos_grabados} de {registry.vinculo.videos_total} videos grabados · {registry.vinculo.fotos_total} registros de fotos</p><a href={`/producciones?visita=${encodeURIComponent(registry.vinculo.id)}`}>Abrir visita en Producciones ↗</a>{registry.vinculo.tipo === "origen" && <p>La fecha y el cliente de esta tarea se editan desde la visita.</p>}{registry.vinculo.tipo === "edicion" && <p>El cliente de esta tarea viene de la visita. La fecha de entrega de edición se puede editar en esta tarea.</p>}{registry.usesIndividual && <p>El registro individual de videos y fotos se administra en Producciones. El flujo agregado histórico queda solo como historial.</p>}</section>}
          <TaskRecordedContext task={task}/>
          <TaskCoordination task={task} sesion={sesion} onUpdate={onUpdate} onDraftStateChange={setCoordinationDraft}/>
          {isAdmin && <ProductionReconciliation taskId={task.id} sesion={sesion} users={users} available={isProductionVisit && registry.ready && !registry.vinculo}
            disabled={saving || commenting || archiving || registeringProduction || confirmingProduction || deliveryBusy || deliveryDirty || coordinationDraft.busy || coordinationDraft.dirty}
            onDraftStateChange={setReconciliationDraft} onSaved={() => setRegistryRetry(value => value + 1)}/>}
        {briefError && <div className="ros-inline-error ros-brief-error" role="alert">{briefError}</div>}
        <TaskContentWorkspace task={task} metadata={metadata} editing={canEditTask || editing} draft={draft} setDraft={setDraft} editorRef={scriptEditorRef} onInsertTemplate={insertContentTemplate} onEditContent={null} onCancelEdit={cancelEditing} onSaveEdit={save} saving={saving} canSave={Boolean(canEditTask && draft.titulo?.trim())}/>
        {hasOperationalControls && <section className="ros-task-operations" aria-labelledby={`ros-task-operations-${task.id}`}>
          <div className="ros-block-heading ros-operations-heading"><div><h3 id={`ros-task-operations-${task.id}`}>Flujo de trabajo</h3></div><small>Acciones y avance de la tarea</small></div>
        {esperandoMaterial(task) && <div className="ros-warning-banner">Esperando material: la tarea de origen todavía no está terminada.</div>}
        {areaForTask(task) === "edicion" && canChangeTaskState && ["pendiente", "en_progreso"].includes(task.estado) && <section className="ros-approval-handoff"><div><strong>¿Terminaste la edición?</strong><span>{task.tipo_tarea === "edicion" && metadata.workspace === "render_os" ? "Registrá el enlace de la versión editada para enviarla a revisión. Publicar es otro paso." : "Cambiar el estado no registra una entrega ni publica el contenido."}</span></div>{task.tipo_tarea === "edicion" && metadata.workspace === "render_os" ? <button type="button" disabled={saving || deliveryBusy} onClick={() => { deliverySectionRef.current?.scrollIntoView({ block: "center" }); deliverySectionRef.current?.querySelector("input")?.focus(); }}>Registrar entrega</button> : <button type="button" disabled={saving} onClick={sendTaskToReview}>Enviar tarea a revisión</button>}</section>}
        {reviewRequestedTaskId === task.id && isAdmin && usesEditingReview && task.estado === 'en_revision' && <p role="status">Revisá la versión entregada y confirmá «Aprobar revisión». Arrastrar no aprueba ni publica.</p>}
        {canApproveForOriana && <section className="ros-approval-handoff"><div><strong>La tarea está esperando aprobación</strong><span>{editorialContext ? 'Aprobá la revisión. Si corresponde, también podés elegir quién publica.' : 'Revisá el trabajo y aprobá esta tarea. Después se podrá finalizar.'}</span>{usesEditingReview && (!editingReviewReady ? <span>Actualizá el historial de entregas antes de aprobar.</span> : editingReview.latestDelivery ? <label><a href={editingReview.latestDelivery.url} target="_blank" rel="noopener noreferrer">Ver entrega · versión de tarea {editingReview.latestDelivery.task_revision} ↗</a><span><input type="checkbox" checked={reviewAcknowledged} disabled={approving || deliveryBusy} onChange={event => setReviewAcknowledged(event.target.checked)}/> Revisé esta versión y la apruebo.</span></label> : <span>Sin entrega registrada: esta aprobación de tarea no certifica un archivo.</span>)}</div><button type="button" disabled={approving || saving || deliveryBusy || deliveryDirty || !mayApproveObservedDelivery} onClick={() => approveForOriana()}>{approving ? "Aprobando…" : "Aprobar revisión"}</button>{editorialContext && <><label>Publica (opcional)<select value={publicationResponsible ?? ""} onChange={(event) => setPublicationResponsible(event.target.value ? Number(event.target.value) : null)}><option value="">Elegí quién publica</option>{users.filter((user) => Number.isSafeInteger(user.id) && user.id > 0 && ["admin", "community"].includes(user.rol)).map((user) => <option key={user.id} value={user.id}>{user.nombre} · #{user.id}</option>)}</select></label><button type="button" disabled={approving || deliveryBusy || deliveryDirty || !mayApproveObservedDelivery || !selectedPublisher} onClick={() => approveForOriana(true)}>{approving ? "Enviando…" : `Aprobar y enviar${selectedPublisher ? ` a ${selectedPublisher.nombre}` : ""}`}</button></>}</section>}
        {canApproveForOriana && usesEditingReview && <div className="ros-work-block"><button type="button" disabled={reviewRefreshing || approving || deliveryBusy} onClick={refreshReviewTask}>{reviewRefreshing ? 'Actualizando…' : 'Actualizar tarea para revisar'}</button><small>Si cambió la versión, actualizá también el historial de entregas y volvé a revisar.</small>{reviewError && <p role="alert">{reviewError}</p>}</div>}
        {task.estado === "aprobada" && <div className="ros-approved-banner">✓ Aprobada por {metadata.revision_aprobada_por || "Líder"}. {editorialContext && metadata.responsable_publicacion ? `${metadata.responsable_publicacion} se encarga de publicarla.` : "Lista para finalizar."}<small style={{display:'block',overflowWrap:'anywhere'}}>{metadata.revision_aprobada === true && typeof metadata.revision_aprobada_entrega_id === 'string' ? `Entrega vinculada: ${metadata.revision_aprobada_entrega_id}` : 'Sin versión de entrega vinculada; no certifica un archivo.'}</small></div>}
        {isProductionVisit && registry.ready && !registry.usesIndividual && <section className="ros-production-visit">
          <header><div><span>VISITA DE PRODUCCIÓN</span><strong>{productionProgress.recorded}{productionProgress.planned ? ` de ${productionProgress.planned}` : ""} videos grabados</strong></div>{productionProgress.complete ? <b>{productionPhase?.label || "Completa"}</b> : <b className="pending">{productionProgress.planned ? `Faltan ${productionProgress.remaining}` : "Sin cantidad prevista"}</b>}</header>
          <div className="ros-production-progress"><i style={{ width: `${productionProgress.planned ? Math.min(100, (productionProgress.recorded / productionProgress.planned) * 100) : 0}%` }}/></div>
          {editing && isAdmin && legacyProductionEnabled && <label className="ros-production-planned"><span>Videos previstos</span><input type="number" min="1" step="1" value={draft.produccion_videos_previstos || ""} onChange={(event) => setDraft({ ...draft, produccion_videos_previstos: event.target.value })}/></label>}
          {!editing && canRegisterProduction && !productionProgress.complete && !metadata.produccion_confirmada_at && <div className="ros-production-entry ros-production-simple">
            <p>Registrá los videos que grabaste. No necesitás una cantidad prevista para terminar la visita.</p>
            {productionProgress.recorded > 0 && <p>Ya hay {productionProgress.recorded} videos registrados. Ingresá solo los nuevos; usá 0 si ya registraste todos.</p>}
            <label><span>Videos grabados sin registrar</span><input inputMode="numeric" type="number" min="0" step="1" value={productionAmount} onChange={(event) => setProductionAmount(event.target.value)}/></label>
            <label><span>Fecha de grabación</span><input type="date" value={productionDate} max={getHoyLocalISO()} onChange={(event) => setProductionDate(event.target.value)}/></label>
            <button type="button" disabled={registeringProduction || !productionDate || !Number.isSafeInteger(Number(productionAmount)) || Number(productionAmount) <= 0} onClick={() => registerProduction(false)}>{registeringProduction ? "Guardando…" : "Guardar avance"}</button>
            <button type="button" disabled={registeringProduction || !productionDate || productionAmount === "" || !Number.isSafeInteger(Number(productionAmount)) || Number(productionAmount) < 0 || productionProgress.recorded + Number(productionAmount) <= 0} onClick={() => registerProduction(true)}>{registeringProduction ? "Guardando…" : "Guardar y terminar visita"}</button>
          </div>}
          {productionProgress.complete && !metadata.produccion_confirmada_at && !isLeader && <div className="ros-production-waiting"><strong>✓ Visita marcada como completa</strong><span>Un líder debe confirmar el registro. Después asignará la edición de cada video desde Producciones.</span></div>}
          {canConfirmProduction && <div className="ros-production-confirm"><div><strong>Grabación completa</strong><span>Confirmá el registro. Después identificá cada video en la revisión histórica y elegí su editor y entrega desde Producciones.</span></div><button type="button" disabled={confirmingProduction} onClick={confirmProduction}>{confirmingProduction ? "Confirmando…" : "Confirmar grabación"}</button></div>}
          {metadata.produccion_confirmada_at && <div className="ros-approved-banner">✓ Grabación confirmada por {metadata.produccion_confirmada_por}. Confirmar no crea tareas de edición; cada video se envía desde Producciones.</div>}
          {!editing && canRegisterProduction && <div className="ros-production-drive"><label><span>Carpeta de material en Google Drive</span><input inputMode="url" placeholder="https://drive.google.com/…" value={productionDriveLink} onChange={(event) => setProductionDriveLink(event.target.value)}/></label><button type="button" disabled={savingProductionDrive || !productionDriveLink.trim() || productionDriveLink.trim() === String(task.material_referencia || "").trim()} onClick={saveProductionDrive}>{savingProductionDrive ? "Guardando…" : task.material_referencia ? "Actualizar enlace" : "Vincular Drive"}</button></div>}

          {Array.isArray(metadata.produccion_registros) && metadata.produccion_registros.length > 0 && <details><summary>Ver registros</summary>{metadata.produccion_registros.slice().reverse().map((record) => <div key={record.id || `${record.fecha}-${record.created_at}`}><strong>+{record.cantidad} videos</strong><span>{formatDate(record.fecha)} · {record.usuario || "Equipo"}{record.corregido_at ? ` · Corregido por ${record.corregido_por}` : ""}</span>{canRegisterProduction && !metadata.produccion_confirmada_at && <button type="button" onClick={() => correctProduction(record)}>Corregir</button>}</div>)}</details>}
        </section>}
        {isProductionVisit&&registry.usesIndividual&&Array.isArray(metadata.produccion_registros)&&metadata.produccion_registros.length>0&&<section className="ros-work-block"><h4>Registro histórico de grabación</h4><p>Conservado sin modificar. Las nuevas grabaciones se registran por video en Producciones.</p><details><summary>Ver registros históricos</summary>{metadata.produccion_registros.slice().reverse().map((record,index)=><div key={record.id||index}><strong>+{record.cantidad} videos</strong><span>{formatDate(record.fecha)} · {record.usuario||'Equipo'}{record.corregido_at?` · Corregido por ${record.corregido_por}`:''}</span></div>)}</details></section>}
        </section>}
        <section className="ros-work-block"><div className="ros-block-heading"><div><h3>{isProductionVisit ? "Material de producción" : "Material y referencias"}</h3></div><small>Archivos y enlaces</small></div>{registry.vinculo?.tipo === "origen" && <p>Consultá el material de esta visita en Producciones. <a href={`/producciones?visita=${encodeURIComponent(registry.vinculo.id)}`}>Abrir visita en Producciones ↗</a></p>}{editing ? <><input className="ros-detail-input" placeholder={isProductionVisit ? "Pegá el enlace de la carpeta de Google Drive" : "https://…"} value={draft.material_referencia || ""} onChange={(event) => setDraft({ ...draft, material_referencia: event.target.value })}/>{isProductionVisit && registry.vinculo?.tipo !== "origen" && <small className="ros-drive-help">Este enlace es obligatorio para enviar la visita a edición.</small>}</> : <><div className="ros-material-grid">{task.material_referencia && <a className="ros-file" href={task.material_referencia} target="_blank" rel="noreferrer"><span>▣</span><div><strong>{isProductionVisit ? "Abrir carpeta en Google Drive" : (materialInfo?.etiqueta || "Material de referencia")}</strong><small>{materialInfo?.dominio || task.material_referencia}</small></div><b>↗</b></a>}{driveFiles.filter((file) => file.url !== task.material_referencia).map((file) => <a className="ros-file" href={file.url} target="_blank" rel="noreferrer" key={file.id}><span>▤</span><div><strong>{file.name}</strong><small>Google Drive · {file.uploaded_by || "Equipo"}</small></div><b>↗</b></a>)}{links.map((url) => { const info = obtenerInfoLinkTarea(url); return <a className="ros-file" href={url} target="_blank" rel="noreferrer" key={url}><span>↗</span><div><strong>{info.etiqueta}</strong><small>{info.dominio}</small></div><b>↗</b></a>; })}{registry.vinculo?.tipo !== "origen" && !task.material_referencia && driveFiles.length === 0 && links.length === 0 && <p className="ros-compact-empty">{isProductionVisit ? "Falta vincular la carpeta de Google Drive." : "Sin material vinculado."}</p>}</div><DriveUploader task={task} onUploaded={refreshUploadedTask}/></>}</section>
        {(origin || task.tarea_padre_id || subtasks.length > 0) && <section className="ros-work-block ros-work-organization"><h3>Organización del trabajo</h3>{(origin || task.tarea_padre_id) && <div className="ros-context-list">{origin && <a className="ros-calendar-origin" href={origin.href}><div><span>{origin.calendarLabel}</span><strong>{origin.label}</strong><small>Fecha de publicación</small></div><time>{formatDate(origin.date)}</time><b>Ver calendario</b></a>}{task.tarea_padre_id && <button type="button" onClick={() => onOpen(Number(task.tarea_padre_id))}><strong>Depende de la tarea #{task.tarea_padre_id}</strong><span>Estado: {STATUSES.find((item) => item.id === canonicalTaskState(task.tarea_padre_estado))?.label || "Sin datos"}</span></button>}</div>}<div className="ros-subtasks">{subtasks.map((subtask) => <button type="button" key={subtask.id} onClick={() => onOpen(subtask.id)}><span>{subtask.titulo}</span><b>{STATUSES.find((item) => item.id === canonicalTaskState(subtask.estado))?.label || subtask.estado}</b></button>)}</div></section>}
        {task.tipo_tarea === "edicion" && metadata.workspace === "render_os" && <div ref={deliverySectionRef}><fieldset disabled={reviewDecisionBusy || reviewDecisionDirty || approving || saving} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}><EditingDeliveries task={task} sesion={sesion} onReviewContext={setEditingReview} onDirty={setDeliveryDirty} onBusy={setDeliveryBusy} onSaved={refreshEditingTaskAfterSave}/></fieldset><EditingReviews task={task} sesion={sesion} disabled={deliveryFormBusy || deliveryFormDirty || approving || saving || editing} onDirty={setReviewDecisionDirty} onBusy={setReviewDecisionBusy} onSaved={refreshEditingTaskAfterSave}/></div>}
          </main>
          <aside className="ros-task-context-rail">
        <details className="ros-more-information" open={editing}><summary>Más información</summary><div className={`ros-properties ${editing ? "editing" : ""}`}><label><span>Estado</span>{editing ? <select value={canonicalTaskState(draft.estado || "pendiente")} onChange={(event) => setDraft({ ...draft, estado: event.target.value })}>{availableTaskStatuses.filter((item) => item.id !== "aprobada" || task.estado === "aprobada").map((item) => <option key={item.id} value={item.id} disabled={isProductionVisit && item.id === "finalizada" && !productionProgress.complete}>{item.label}</option>)}</select> : <strong><i style={{ color: status.color }}>●</i>{status.label}</strong>}</label><label><span>Cliente</span>{editing && canEditVisitClient ? <select value={draft.cliente_id || ""} onChange={(event) => setDraft({ ...draft, cliente_id: event.target.value ? Number(event.target.value) : "" })}><option value="">Sin cliente</option>{clients.map((client) => <option key={client.id} value={client.id}>{client.nombre}</option>)}</select> : <strong>{task.cliente_nombre || "Sin cliente"}</strong>}</label><label><span>{registry.vinculo?.tipo === "origen" ? "Fecha de visita" : "Vencimiento"}</span>{editing && canEditVisitDate ? <input type="date" value={draft.fecha_vencimiento || ""} onChange={(event) => setDraft({ ...draft, fecha_vencimiento: event.target.value })}/> : <strong>{formatDate(task.fecha_vencimiento)}</strong>}</label><label><span>Prioridad</span>{editing ? <select value={draft.prioridad || "media"} onChange={(event) => setDraft({ ...draft, prioridad: event.target.value })}><option value="baja">Baja</option><option value="media">Media</option><option value="alta">Alta</option></select> : <strong>{task.prioridad || "Media"}</strong>}</label><label><span>Sector</span>{editing ? <select value={draft.tipo_tarea || ""} onChange={(event) => setDraft({ ...draft, tipo_tarea: event.target.value })}><option value="">Sin sector</option>{TASK_TYPES.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select> : <strong>{task.tipo_tarea || "Sin definir"}</strong>}</label></div>{editing && <div className="ros-edit-extras"><label><span>Subtipo</span><input value={draft.subtipo || ""} onChange={(event) => setDraft({ ...draft, subtipo: event.target.value })}/></label><label><span>Resumen corto</span><input value={draft.resumen || ""} onChange={(event) => setDraft({ ...draft, resumen: event.target.value })}/></label><label><span>Etiquetas</span><input value={draft.etiquetas || ""} onChange={(event) => setDraft({ ...draft, etiquetas: event.target.value })}/></label></div>}<div className="ros-origin"><span>ID #{task.id}</span><span>Creada: {formatDate(task.created_at)}</span><span>Actualizada: {formatDate(task.updated_at)}</span></div></details>
          </aside>
        </div>
        <section className="ros-task-comments-footer">
          <h3>Comentarios</h3>
          <button type="button" className="ros-comment-action" disabled={Boolean(commentDraftOwner.current.refresh)} onClick={refreshComments}>{commentDraftOwner.current.refresh ? 'Actualizando…' : 'Actualizar comentarios'}</button>
          {commentDraftOwner.current.readError && <div className="ros-inline-error">{commentDraftOwner.current.readError}</div>}
          {commentError && <div className="ros-inline-error">{commentError}</div>}
          {commentDraftOwner.current.creation.snapshot.locked && <p role="status">Salir no cancela ni revierte el envío. Este intento no sobrevive a una recarga. Verificá el envío antes de salir.</p>}
          {commentDraftOwner.current.creation.snapshot.canVerify && <button type="button" className="ros-comment-action" onClick={verifyCommentCreation}>Verificar envío</button>}
          {teamComments.length > 0 && <div className="ros-comments">{teamComments.map((item) => <article key={item.id}><Avatar person={users.find((user) => user.nombre === item.autor)} name={item.autor}/><div className="ros-comment-body"><header><strong>{item.autor}</strong><time>{formatDateTime(item.created_at)}</time></header><p>{renderizarTextoTarea(item.contenido)}</p></div></article>)}</div>}
          <div className="ros-comment-create">
            <Avatar person={users.find((user) => user.nombre === sesion?.usuario?.nombre)} name={sesion?.usuario?.nombre || sesion?.usuario?.usuario}/>
            <textarea rows={2} value={comment} placeholder="Agregar un comentario…" aria-label="Agregar un comentario" onChange={(event) => { commentDraftOwner.current.generation++; setComment(event.target.value); }}/>
            <button type="button" disabled={!comment.trim() || commenting || commentDraftOwner.current.creation.snapshot.locked} onClick={addComment}>{commenting ? "Enviando…" : "Comentar"}</button>
          </div>
        </section>
        {isAdmin && editing && <div className="ros-detail-actions ros-edit-footer"><button type="button" onClick={cancelEditing}>Cancelar</button><button className="primary" type="button" disabled={saving || !canEditTask || !draft.titulo?.trim()} onClick={save}>{saving ? "Guardando…" : "Guardar cambios"}</button></div>}
        {canDeleteTask && <details className="ros-task-admin-actions ros-task-admin-actions-footer"><summary>Acciones de tarea</summary><div className="ros-danger-zone"><strong>{isTrashed ? "Tarea eliminada" : "Eliminar tarea"}</strong><p>{isTrashed ? "Podés restaurarla antes de que se elimine definitivamente." : "Permanecerá 10 días en Papelera antes de eliminarse definitivamente."}</p><div><button className={isTrashed ? "" : "danger"} type="button" disabled={archiving} onClick={changeTrashState}>{archiving ? (isTrashed ? "Restaurando…" : "Enviando…") : (isTrashed ? "Restaurar tarea" : "Enviar a Papelera")}</button></div></div></details>}
      </div>
    </aside>
    <DiscardChangesDialog open={discardDialogOpen} busy={taskWriteBusy}
      description={commentDraftOwner.current.creation.snapshot.locked ? "Salir no cancela ni revierte el envío. Este intento no sobrevive a una recarga. Verificá el envío antes de salir." : undefined}
      onKeepEditing={() => setDiscardDialogOpen(false)} onDiscard={discardDetail}/>
  </div>;
}

function TaskPeoplePicker({ users, primaryId, collaboratorIds, onChange, compact = false, disabled = false }) {
  const [open, setOpen] = useState(false);
  const selected = [primaryId, ...(collaboratorIds || [])].filter((id, index, items) => Number.isSafeInteger(id) && id > 0 && items.indexOf(id) === index);
  const labelFor = (id) => users.find((user) => user.id === id)?.nombre || `Usuario #${id}`;
  const toggle = (id) => {
    if (disabled) return;
    const next = selected.includes(id) ? selected.filter((item) => item !== id) : [...selected, id];
    onChange({ ownerId: next[0] ?? null, collaboratorIds: next.slice(1), primary: next.length ? labelFor(next[0]) : "", collaborators: next.slice(1).map(labelFor) });
  };
  return <div className={`wide ros-people-picker ${compact ? "compact" : ""}`}>
    {!compact && <div className="ros-people-picker-label"><span>Responsables *</span><small>Podés seleccionar una o varias personas.</small></div>}
    {selected.length > 0 && <div className="ros-selected-people">{selected.map((id) => <button type="button" key={id} disabled={disabled} onClick={() => toggle(id)}><Avatar person={users.find((user) => user.id === id)} name={labelFor(id)}/><span><strong>{labelFor(id)}</strong><small>Responsable · #{id}</small></span><b aria-hidden="true">×</b></button>)}</div>}
    <button className="ros-add-person" type="button" disabled={disabled} aria-expanded={open} onClick={() => setOpen((current) => !current)}><span>+</span>{selected.length ? "Añadir otra persona" : "Añadir responsable"}<b>{open ? "⌃" : "⌄"}</b></button>
    {open && <div className="ros-people-options">{users.filter((user) => Number.isSafeInteger(user.id) && user.id > 0).map((user) => { const active = selected.includes(user.id); return <button className={active ? "selected" : ""} type="button" key={user.id} disabled={disabled} onClick={() => toggle(user.id)}><Avatar person={user}/><span><strong>{user.nombre}</strong><small>{getRolLabel(user.rol)} · @{user.usuario || user.id} · #{user.id}</small></span><b>{active ? "✓" : "+"}</b></button>; })}</div>}
  </div>;
}

function NewTaskModal({ users, clients, sesion, initialStatus = "pendiente", onClose, onCreate, onCreated }) {
  const captureRequest = useWorkspaceCapture(sesion);
  const [draft, setDraft] = useState({ titulo: "", asignado_a: "", asignado_a_id: null, colaborador_ids: [], cliente_id: "", estado: ["pendiente", "en_progreso", "en_revision"].includes(initialStatus) ? initialStatus : "pendiente", tipo_tarea: "", subtipo: "", prioridad: "media", fecha_vencimiento: "", aclaraciones: "", material_referencia: "", resumen: "", etiquetas: "", colaboradores: [], produccion_videos_previstos: "" });
  const [saving, setSaving] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [suggestionMessage, setSuggestionMessage] = useState("");
  const manuallyEdited = useRef(new Set());
  const completedRef = useRef(false);
  const createCallback=useRef(onCreate);createCallback.current=onCreate;
  const [,renderCreation]=useState(0);
  const [creation]=useState(()=>createTaskCreationAttempt({capture:captureRequest,
    send:(body,options)=>createCallback.current(body,options),onState:state=>{setSaving(state.busy);renderCreation(n=>n+1)}}));
  const creationState=creation.snapshot;
  useNavigationGuard(() => ({ dirty: !completedRef.current && (isNewTaskDraftDirty(draft)||creation.snapshot.locked), busy: !completedRef.current && creation.snapshot.busy }));
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previous; };
  }, []);
  const runCreation = async (action) => {
    const guard = captureRequest();
    if (!guard.current()||completedRef.current) return;
    const confirmed=await action();
    if(!confirmed||!guard.current()||completedRef.current)return;
    completedRef.current=true;onCreated(creation.snapshot.accepted.task);
  };
  const submit = (event) => {
    event.preventDefault();
    if(creation.snapshot.locked||creation.snapshot.busy)return;
    const input={...draft,produccion_videos_previstos:isProductionVisitTask(draft)?draft.produccion_videos_previstos:undefined};
    void runCreation(()=>creation.start(input));
  };
  const closeModal = () => {
    if (creation.snapshot.busy) return;
    if ((isNewTaskDraftDirty(draft)||creation.snapshot.locked) && !window.confirm(creation.snapshot.locked
      ?'El resultado puede estar guardado. Salir no cancela la creación y este intento no sobrevive a una recarga. ¿Querés salir sin verificarlo?'
      :'¿Querés descartar este borrador de tarea?')) return;
    onClose();
  };
  const applySuggestions = (current, { title = current.titulo, clientId = current.cliente_id, clientWasSelected = false } = {}) => {
    const suggestion = getNewTaskSuggestions({ title, clients, users, clientId: clientWasSelected || manuallyEdited.current.has("client") ? (clientId || "__none__") : "" });
    const next = { ...current, titulo: title };
    if (!manuallyEdited.current.has("client")) next.cliente_id = suggestion.client ? String(suggestion.client.id) : "";
    if (!manuallyEdited.current.has("people")) {
      // Creation suggestions only: never resolve historical assignments by label.
      const labels = [suggestion.primary, ...suggestion.collaborators].filter(Boolean);
      const matches = labels.map((label) => users.filter((user) => user.nombre === label && Number.isSafeInteger(user.id) && user.id > 0));
      const unambiguous = matches.every((items) => items.length === 1);
      const selected = unambiguous ? [...new Map(matches.map(([user]) => [user.id, user])).values()] : [];
      next.asignado_a_id = selected[0]?.id ?? null;
      next.colaborador_ids = selected.slice(1).map((user) => user.id);
      next.asignado_a = selected[0]?.nombre || "";
      next.colaboradores = selected.slice(1).map((user) => user.nombre);
      if (!unambiguous) suggestion.message = "La sugerencia no identifica una persona única. Elegí los responsables manualmente.";
    }
    if (!manuallyEdited.current.has("classification")) {
      next.tipo_tarea = suggestion.tipo_tarea;
      next.subtipo = suggestion.subtipo;
    }
    setSuggestionMessage(suggestion.message);
    return next;
  };
  return <div className="ros-drawer-backdrop ros-modal-backdrop" onClick={closeModal}><section className="ros-modal ros-quick-task-modal" onClick={(event) => event.stopPropagation()}><header><div><div className="ros-eyebrow">NUEVA TAREA</div><h2>¿Qué hay que hacer?</h2><p>Cargá lo esencial ahora. Los detalles se pueden completar después.</p></div><button type="button" aria-label="Cerrar" onClick={closeModal}>×</button></header><form onSubmit={submit}><fieldset disabled={creationState.locked||saving} style={{display:"contents",border:0,padding:0,margin:0,minWidth:0}}>
    <label className="wide ros-quick-title"><span>Tarea *</span><input autoFocus required placeholder="Ej.: iPhone Shop | Editar reel de lanzamiento" value={draft.titulo} onChange={(event) => setDraft((current) => applySuggestions(current, { title: event.target.value }))}/></label>
    {suggestionMessage && <div className="wide ros-auto-suggestion"><span>✓</span><div><strong>{suggestionMessage}</strong><small>Es una sugerencia automática: podés cambiar cualquier dato.</small></div></div>}
    <TaskPeoplePicker users={users} primaryId={draft.asignado_a_id} collaboratorIds={draft.colaborador_ids || []} disabled={creationState.locked||saving} onChange={({ primary, collaborators, ownerId, collaboratorIds }) => { manuallyEdited.current.add("people"); setDraft({ ...draft, asignado_a: primary, colaboradores: collaborators, ...buildTaskAssignmentInput({ ownerId, collaboratorIds }) }); }}/>
    <div className="wide ros-quick-grid"><label><span>Cliente</span><select value={draft.cliente_id} onChange={(event) => { manuallyEdited.current.add("client"); setDraft((current) => applySuggestions({ ...current, cliente_id: event.target.value }, { clientId: event.target.value, clientWasSelected: true })); }}><option value="">Sin cliente</option>{clients.map((client) => <option key={client.id} value={client.id}>{client.nombre}</option>)}</select></label><label><span>Fecha</span><input type="date" value={draft.fecha_vencimiento} onChange={(event) => setDraft({ ...draft, fecha_vencimiento: event.target.value })}/></label><label><span>Prioridad</span><select value={draft.prioridad} onChange={(event) => setDraft({ ...draft, prioridad: event.target.value })}><option value="baja">Baja</option><option value="media">Media</option><option value="alta">Alta</option></select></label></div>
    {isProductionVisitTask(draft) && !showDetails && <label className="wide ros-visit-planned-field"><span>Videos previstos (opcional)</span><input type="number" min="1" step="1" value={draft.produccion_videos_previstos} onChange={(event) => setDraft({ ...draft, produccion_videos_previstos: event.target.value })}/></label>}
    <button className="wide ros-more-details" type="button" aria-expanded={showDetails} onClick={() => setShowDetails((current) => !current)}><span>{showDetails ? "−" : "+"}</span>{showDetails ? "Ocultar detalles" : "Agregar indicaciones, material o más detalles"}</button>
    {showDetails && <div className="wide ros-optional-fields"><label><span>Sector</span><select value={draft.tipo_tarea} onChange={(event) => { manuallyEdited.current.add("classification"); setDraft({ ...draft, tipo_tarea: event.target.value }); }}><option value="">Sin sector</option>{TASK_TYPES.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label><label><span>Tipo de pieza</span><input placeholder="Reel, carrusel, visita…" value={draft.subtipo} onChange={(event) => { manuallyEdited.current.add("classification"); setDraft({ ...draft, subtipo: event.target.value }); }}/></label>{isProductionVisitTask(draft) && <label className="wide ros-visit-planned-field"><span>Videos previstos (opcional)</span><input type="number" min="1" step="1" value={draft.produccion_videos_previstos} onChange={(event) => setDraft({ ...draft, produccion_videos_previstos: event.target.value })}/></label>}<label className="wide"><span>Resumen corto</span><input value={draft.resumen} placeholder="Resultado esperado" onChange={(event) => setDraft({ ...draft, resumen: event.target.value })}/></label><label className="wide"><span>Indicaciones</span><textarea rows={3} placeholder="Datos necesarios para poder resolverla" value={draft.aclaraciones} onChange={(event) => setDraft({ ...draft, aclaraciones: event.target.value })}/></label><label className="wide"><span>Material o enlace</span><input placeholder="https://…" value={draft.material_referencia} onChange={(event) => setDraft({ ...draft, material_referencia: event.target.value })}/></label><label className="wide"><span>Etiquetas</span><input placeholder="Urgente, web, corrección" value={draft.etiquetas} onChange={(event) => setDraft({ ...draft, etiquetas: event.target.value })}/></label></div>}
    </fieldset>{creationState.error&&<div className="wide" role="alert">{creationState.error}</div>}
    {creationState.locked&&<div className="wide"><p>Conservamos el mismo intento. Verificar no crea otra tarea.</p><p>El intento no sobrevive a una recarga. Verificá antes de salir.</p>{creationState.canVerify&&<button type="button" onClick={()=>void runCreation(()=>creation.verify())}>Verificar creación</button>}{creationState.canRetry&&<button type="button" onClick={()=>void runCreation(()=>creation.retry())}>Reintentar el mismo intento</button>}</div>}
    <footer><button type="button" disabled={saving} onClick={closeModal}>Cancelar</button>{!creationState.locked&&<button className="primary" type="submit" disabled={saving || !draft.titulo.trim() || !draft.asignado_a_id}>{saving ? "Creando…" : "Crear tarea"}</button>}</footer>
  </form></section></div>;
}

const TaskCard = React.memo(function TaskCard({ task, users, user, today, onOpen, onMove, canMove, onOrderDrop, manualControls, moveBlocked = false }) {
  const dragRef = useRef({ blocked: false, suppressClick: false });
  const person = personForTask(task, users);
  const tags = Array.isArray(task.propiedades_extra?.etiquetas) ? task.propiedades_extra.etiquetas : [];
  const responsibleLabels = taskResponsibles(task, users);
  const primaryLabel = responsibleLabels[0] || "Sin responsables";
  const phase = getProductionPhase(task);
  const availableStatuses = STATUSES.filter((item) => item.id === canonicalTaskState(task.estado) || canUserMoveTaskToState(task, user, item.id));
  const canDrag = canMove || Boolean(manualControls);
  const startDrag = (event) => {
    if (!canDrag || moveBlocked || dragRef.current.blocked) { event.preventDefault(); return; }
    dragRef.current.suppressClick = true;
    event.stopPropagation();
    event.dataTransfer.setData("text/task-id", String(task.id));
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setDragImage(event.currentTarget, event.clientX - event.currentTarget.getBoundingClientRect().left, event.clientY - event.currentTarget.getBoundingClientRect().top);
    event.currentTarget.classList.add("is-dragging");
  };
  const endDrag = (event) => event.currentTarget.classList.remove("is-dragging");
  return <article data-task-id={task.id} draggable={canDrag} className={`ros-task-card ${canDrag ? "can-move" : "view-only"}`}
    onPointerDown={(event) => { dragRef.current = { blocked: Boolean(event.target.closest('button,select,input,textarea,a,[contenteditable="true"]')), suppressClick: false }; }}
    onDragStart={startDrag} onDragEnd={endDrag}
    onDragOver={onOrderDrop ? event => { if(event.dataTransfer.types.includes('text/task-id')) event.preventDefault(); } : undefined}
    onDrop={onOrderDrop ? event => onOrderDrop(event,task) : undefined}
    onClick={(event) => { if (dragRef.current.suppressClick || event.target.closest('button,select,input,textarea,a,[contenteditable="true"]')) return; onOpen(task.id); }}>
    <div className="ros-card-badges"><AreaBadge task={task} card/>{phase && <span className={`ros-phase-badge ${phase.id}`}>{phase.label}</span>}{canDrag && <span className="ros-card-drag-handle" aria-hidden="true" title="Arrastrá desde la tarjeta, fuera de sus controles">⠿</span>}</div><h3><button type="button" className="ros-card-open" onClick={()=>onOpen(task.id)}>{task.titulo}</button></h3><p>{task.cliente_nombre || "Sin cliente"}</p>
    {task.propiedades_extra?.resumen && <div className="ros-card-summary">{task.propiedades_extra.resumen}</div>}
    {task.estado === 'en_revision' && effectiveTaskFilterState(task) === 'aprobada' && <small className="ros-card-summary">Aprobada (registro histórico; sin evidencia de entrega)</small>}
    {tags.length > 0 && <div className="ros-card-tags">{tags.slice(0, 3).map((tag) => <span key={tag}>{tag}</span>)}</div>}
    {esperandoMaterial(task) && <div className="ros-card-warning">Esperando material</div>}
    <footer><Avatar person={person} name={primaryLabel}/><span title={`Responsables: ${taskResponsiblesLabel(task, users)}`}>{primaryLabel}{responsibleLabels.length > 1 ? ` +${responsibleLabels.length - 1}` : ""}</span><b className={task.fecha_vencimiento && task.fecha_vencimiento < today && !isTaskCompleted(task) ? "urgent" : ""}>□ {formatDate(task.fecha_vencimiento)}</b></footer>
    {manualControls && <div className="ros-order-actions" role="group" aria-label={`Orden manual de ${task.titulo}`} onClick={event=>event.stopPropagation()}><button type="button" style={{minHeight:44,minWidth:44}} disabled={!manualControls.up} aria-label={`Subir ${task.titulo} antes de la tarea anterior cargada`} onClick={manualControls.up}>↑</button><button type="button" style={{minHeight:44,minWidth:44}} disabled={!manualControls.down} aria-label={`Bajar ${task.titulo} una posición entre las tareas cargadas`} onClick={manualControls.down}>↓</button><button type="button" style={{minHeight:44}} disabled={!manualControls.end} aria-label={`Mover ${task.titulo} al final de la columna completa`} title={`Mover ${task.titulo} al final de la columna completa`} onClick={manualControls.end}>Al final</button></div>}
    {canMove && <select className="ros-mobile-state" disabled={moveBlocked} aria-label={`Cambiar estado de ${task.titulo}`} value={canonicalTaskState(task.estado)} onClick={(event) => event.stopPropagation()} onChange={(event) => { event.stopPropagation(); onMove(task, event.target.value); }}>{availableStatuses.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select>}
  </article>;
});

function TaskCalendar({ tasks, users = [], onOpen, monthValue, onMonthChange }) {
  const [cursor, setCursor] = useState(() => {
    if (monthValue) { const [year, month] = monthValue.split("-").map(Number); return new Date(year, month - 1, 1); }
    const now = new Date(); return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [selectedDate, setSelectedDate] = useState("");
  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const firstOffset = (new Date(year, month, 1).getDay() + 6) % 7;
  const days = new Date(year, month + 1, 0).getDate();
  const totalCells = Math.ceil((firstOffset + days) / 7) * 7;
  const cells = Array.from({ length: totalCells }, (_, index) => {
    const day = index - firstOffset + 1;
    return day > 0 && day <= days ? day : null;
  });
  const byDate = new Map();
  tasks.forEach((task) => { if (!task.fecha_vencimiento) return; const key = String(task.fecha_vencimiento).slice(0, 10); byDate.set(key, [...(byDate.get(key) || []), task]); });
  const today = getHoyLocalISO();
  const label = cursor.toLocaleDateString("es-AR", { month: "long", year: "numeric" });
  const moveMonth = (delta) => { const next = new Date(year, month + delta, 1); setSelectedDate(""); setCursor(next); onMonthChange(`${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}`); };
  const selectedTasks = selectedDate ? byDate.get(selectedDate) || [] : [];
  const selectedDateLabel = selectedDate ? new Date(`${selectedDate}T12:00:00`).toLocaleDateString("es-AR", { weekday: "long", day: "numeric", month: "long" }) : "";
  useEffect(() => {
    if (!selectedDate) return undefined;
    const closeOnEscape = (event) => { if (event.key === "Escape") setSelectedDate(""); };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [selectedDate]);
  const openFromSummary = (taskId) => { setSelectedDate(""); onOpen(taskId); };
  return <>
    <section className="ros-calendar">
      <header><button type="button" aria-label="Mes anterior" onClick={() => moveMonth(-1)}>‹</button><strong>{label}</strong><button type="button" aria-label="Mes siguiente" onClick={() => moveMonth(1)}>›</button></header>
      <div className="ros-calendar-week"><span>Lun</span><span>Mar</span><span>Mié</span><span>Jue</span><span>Vie</span><span>Sáb</span><span>Dom</span></div>
      <div className="ros-calendar-grid">{cells.map((day, index) => {
        if (!day) return <div className="ros-calendar-day muted" key={`empty-${index}`}/>;
        const key = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
        const items = byDate.get(key) || [];
        return <div className={`ros-calendar-day ${key === today ? "today" : ""}`} key={key}>
          <button className="ros-calendar-day-number" type="button" aria-label={`Ver resumen del ${day}`} onClick={() => setSelectedDate(key)}>{day}</button>
          <div className="ros-calendar-day-tasks">{items.slice(0, 3).map((task) => <button className={`ros-calendar-task area-${areaForTask(task)}`} title={`${task.titulo} · ${task.cliente_nombre || "Sin cliente"}`} type="button" key={task.id} onClick={() => onOpen(task.id)}><strong>{task.titulo}</strong><small>{task.cliente_nombre || "Sin cliente"}</small></button>)}{items.length > 3 && <button className="ros-calendar-more" type="button" onClick={() => setSelectedDate(key)}>+{items.length - 3} más</button>}</div>
        </div>;
      })}</div>
      {tasks.some((task) => !task.fecha_vencimiento) && <p className="ros-calendar-note">{tasks.filter((task) => !task.fecha_vencimiento).length} tareas sin fecha no aparecen en el calendario.</p>}
    </section>
    {selectedDate && <div className="ros-day-preview-backdrop" role="presentation" onMouseDown={() => setSelectedDate("")}>
      <section className="ros-day-preview" role="dialog" aria-modal="true" aria-labelledby="ros-day-preview-title" onMouseDown={(event) => event.stopPropagation()}>
        <header><div><small>Resumen del día</small><h2 id="ros-day-preview-title">{selectedDateLabel}</h2><span>{selectedTasks.length} {selectedTasks.length === 1 ? "tarea" : "tareas"}</span></div><button type="button" aria-label="Cerrar resumen" onClick={() => setSelectedDate("")}>×</button></header>
        <div className="ros-day-preview-list">{selectedTasks.map((task) => { const state = STATUSES.find((item) => item.id === effectiveTaskFilterState(task)); return <button type="button" key={task.id} onClick={() => openFromSummary(task.id)}><i style={{ background: state?.color || "#8d9095" }}/><div><strong>{task.titulo}</strong><span>{task.cliente_nombre || "Sin cliente"} · {taskResponsiblesLabel(task, users)}</span></div><b>{state?.label || task.estado}</b><em>›</em></button>; })}{selectedTasks.length === 0 && <div className="ros-day-preview-empty"><span>○</span><strong>No hay tareas para este día</strong><small>Podés elegir otra fecha o cerrar el resumen.</small></div>}</div>
      </section>
    </div>}
  </>;
}

const TasksByClient = React.memo(function TasksByClient({ tasks, users = [], onOpen }) {
  const groups = useMemo(() => groupTasksByClient(tasks), [tasks]);
  return <TaskGroups groups={groups} users={users} onOpen={onOpen}/>;
});

const TasksByResponsible = React.memo(function TasksByResponsible({ tasks, users = [], onOpen }) {
  const groups = useMemo(() => groupTasksByResponsible(tasks, users), [tasks, users]);
  return <><p className="ros-calendar-note">Las tareas compartidas aparecen en cada responsable. Los conteos incluyen sólo las tareas cargadas con los filtros actuales.</p><TaskGroups groups={groups} users={users} onOpen={onOpen}/></>;
});

function TaskGroups({ groups, users, onOpen }) {
  return <div className="ros-project-grid">{groups.map((group) => <section className="ros-project-card" key={group.key}><header><div><span>{initials(group.label)}</span><strong>{group.label}</strong></div><small>{group.tasks.length} {group.tasks.length === 1 ? "tarea cargada" : "tareas cargadas"}</small></header><div>{group.tasks.map((task) => <button type="button" key={task.id} onClick={() => onOpen(task.id)}><span>{task.titulo}</span><b>{STATUSES.find((item) => item.id === effectiveTaskFilterState(task))?.label || task.estado}</b><small>{task.cliente_nombre || "Sin cliente"} · {taskResponsiblesLabel(task, users)} · {formatDate(task.fecha_vencimiento)}</small></button>)}</div></section>)}</div>;
}

function TasksView({ tasks, totalTasks, loadingMore, onLoadMore, users, clients, query, setQuery, area, setArea, responsible, setResponsible, client, setClient, sector, setSector, priority, setPriority, archiveMode, setArchiveMode, sort, setSort, taskStatus, setTaskStatus, reviewScope, setReviewScope, queryNotice, onRefreshReview, manualReady, orderState, orderMessage, onReorder, onVerifyOrder, onRefreshOrder, pagingBlocked, sesion, onCreate, onUpdate, onRegisterProduction, onCorrectProduction, onConfirmProduction, onApprove, onBulkAction, onError }) {
  const captureRequest = useWorkspaceCapture(sesion);
  const initialViewState = useMemo(() => getTaskViewState(window.location.search), []);
  const initialTask = Number(new URLSearchParams(window.location.search).get("task")) || null;
  const [view, setView] = useState(initialViewState.view);
  const [calendarMonth, setCalendarMonth] = useState(initialViewState.calendarMonth);
  const [selectedId, setSelectedId] = useState(initialTask);
  const [reviewRequestedTaskId, setReviewRequestedTaskId] = useState(null);
  const [creatingStatus, setCreatingStatus] = useState(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [dragOver, setDragOver] = useState("");
  const [columnLimits, setColumnLimits] = useState({});
  const [listLimit, setListLimit] = useState(500);
  const [newFeedbackCount, setNewFeedbackCount] = useState(0);
  const [mobileBoardColumn, setMobileBoardColumn] = useState(initialViewState.boardColumn);
  const compactBoard = useMediaQuery("(max-width: 1024px)");
  const boardRef = useRef(null);
  const mobileBoardNavRef = useRef(null);
  const tasksLatestRef = useRef(tasks);
  tasksLatestRef.current = tasks;
  const openRequestRef = useRef(null);
  useEffect(() => () => openRequestRef.current?.abort(), []);
  const today = getHoyLocalISO();
  const selected = tasks.find((task) => task.id === selectedId) || null;
  const responsibleOptions = useMemo(() => buildResponsibleOptions(users, tasks, responsible), [users, tasks, responsible]);
  const responsibleNotice = resolveResponsibleFilter(responsible, users, true, sesion?.usuario?.rol === 'admin').message;
  const visible = useMemo(() => tasks.filter((task) => {
    const collaborators = Array.isArray(task.propiedades_extra?.colaboradores) ? task.propiedades_extra.colaboradores : [];
    const text = `${task.titulo} ${task.cliente_nombre || ""} ${task.asignado_a || ""} ${collaborators.join(" ")} ${task.propiedades_extra?.resumen || ""}`.toLowerCase();
    const isArchived = task.propiedades_extra?.archivada_render_os === true;
    const isTrashed = task.propiedades_extra?.papelera_render_os === true;
    return !task.__renderOsDirectOnly
      && (archiveMode === "trash" ? isTrashed : !isArchived && !isTrashed)
      && (taskStatus === "all" || effectiveTaskFilterState(task) === taskStatus)
      && taskMatchesReviewScope(task, reviewScope, sesion?.usuario)
      && (area === "all" || areaForTask(task) === area)
      && taskMatchesResponsible(task, responsible)
      && (client === "all" || String(task.cliente_id || "none") === client)
      && (sector === "all" || String(task.tipo_tarea || "none") === sector)
      && (priority === "all" || task.prioridad === priority)
      && (reviewScope || text.includes(query.toLowerCase()));
  }), [tasks, query, area, responsible, client, sector, priority, archiveMode, taskStatus, reviewScope, sesion?.usuario]);
  const boardColumnCounts = useMemo(() => Object.fromEntries(BOARD_COLUMNS.map((column) => [
    column.id,
    visible.filter((task) => column.states.includes(effectiveTaskFilterState(task))).length,
  ])), [visible]);
  const renderedBoardColumns = useMemo(() => compactBoard
    ? BOARD_COLUMNS.filter((column) => column.id === mobileBoardColumn)
    : BOARD_COLUMNS, [compactBoard, mobileBoardColumn]);
  useTaskBoardMotion(boardRef, visible, view);
  const paginatedTaskCount = tasks.filter((task) => !task.__renderOsDirectOnly).length;
  const hasFilters = responsible !== "all" || client !== "all" || sector !== "all" || priority !== "all" || area !== "all" || taskStatus !== "all";
  const activeFilterCount = [responsible, client, sector, priority, area, taskStatus].filter((value) => value !== "all").length + Number(Boolean(reviewScope));
  const emptyMessage = getTasksEmptyMessage({ hasFilters, query, totalTasks, archiveMode });
  const refreshFeedbackCount = useCallback(async () => {
    const guard = captureRequest();
    if (!guard.current()) return;
    const seenAt = readFeedbackSeenAt(sesion?.usuario);
    if (!seenAt) {
      markFeedbackSeen(sesion?.usuario);
      setNewFeedbackCount((current) => current === 0 ? current : 0);
      return;
    }
    try {
      const result = await guard.request(`/api/notas/nuevas?desde=${encodeURIComponent(seenAt)}`);
      guard.assertCurrent();
      const nextCount = Math.max(0, Number(result?.cantidad) || 0);
      setNewFeedbackCount((current) => current === nextCount ? current : nextCount);
    } catch {
      // El aviso es complementario: una falla nunca debe bloquear el tablero.
    }
  }, [captureRequest]);

  useEffect(() => {
    void refreshFeedbackCount();
    const interval = window.setInterval(refreshFeedbackCount, 45_000);
    const refreshWhenVisible = () => { if (!document.hidden) void refreshFeedbackCount(); };
    window.addEventListener("focus", refreshWhenVisible);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", refreshWhenVisible);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [refreshFeedbackCount]);

  const incorporateRelatedTasks = useCallback((items) => {
    const guard = captureRequest();
    if (!guard.current()) return;
    if (!items.length) return;
    window.dispatchEvent(new CustomEvent("render-os:related-tasks", { detail: items }));
  }, [captureRequest]);
  const loadSubtasks = useCallback(async (id, options) => {
    const guard = captureRequest(apiJson);
    const items = await guard.request(`/api/tareas/${id}/subtareas?workspace=render_os`, options);
    guard.assertCurrent();
    if (!options?.signal?.aborted) incorporateRelatedTasks(items);
    return items;
  }, [incorporateRelatedTasks, captureRequest]);

  const openTask = useCallback(async (id, requestReview = false) => {
    const guard = captureRequest();
    if (!guard.current()) return;
    openRequestRef.current?.abort();
    const controller = new AbortController();
    openRequestRef.current = controller;
    const cached = tasksLatestRef.current.find(task => task.id === id);
    const show = () => {
      if (!guard.current() || controller.signal.aborted || openRequestRef.current !== controller) return false;
      const url = new URL(window.location.href);
      const alreadyOpen = url.searchParams.get('task') === String(id);
      if (!alreadyOpen) {
        url.searchParams.set("task", String(id));
        if (!requestAppNavigation(window, url.href)) return false;
      }
      if (!guard.current() || controller.signal.aborted || openRequestRef.current !== controller) return false;
      setReviewRequestedTaskId(requestReview === true ? id : null);
      setSelectedId(id);
      if (!alreadyOpen) window.history.pushState({ task: id }, "", url);
      return true;
    };
    if (cached && !show()) return;
    try {
      const task = await guard.request(`/api/tareas/${id}?workspace=render_os`, { signal: controller.signal });
      guard.assertCurrent();
      if (controller.signal.aborted || openRequestRef.current !== controller) return;
      // No sobrescribir una edición optimista realizada mientras llegaba la consulta.
      if (!cached || tasksLatestRef.current.find(item => item.id === id) === cached) incorporateRelatedTasks([task]);
      if (!cached) show();
    } catch (reason) {
      if (guard.current() && !isSessionFailure(reason) && !controller.signal.aborted) onError(reason.message || "No se pudo actualizar la tarea.");
    }
  }, [incorporateRelatedTasks, captureRequest]);
  const closeTask = useCallback(() => {
    openRequestRef.current?.abort();
    setReviewRequestedTaskId(null);
    setSelectedId(null);
    if (window.history.state?.task) {
      window.history.back();
      return;
    }
    const url = new URL(window.location.href);
    url.searchParams.delete("task");
    window.history.replaceState({}, "", url);
  }, []);
  useEffect(() => {
    const onPop = () => {
      openRequestRef.current?.abort();
      setReviewRequestedTaskId(null);
      setSelectedId(Number(new URLSearchParams(window.location.search).get("task")) || null);
      const next = getTaskViewState(window.location.search);
      setView(next.view); setCalendarMonth(next.calendarMonth); setMobileBoardColumn(next.boardColumn);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  useEffect(() => {
    writeTaskViewUrl(window, { view, sort, archiveMode, responsible, client, sector, priority, area, query, calendarMonth, status:taskStatus, reviewScope, boardColumn:mobileBoardColumn });
  }, [view, sort, archiveMode, responsible, client, sector, priority, area, query, calendarMonth, taskStatus, reviewScope, mobileBoardColumn]);

  const move = useCallback((task, status) => {
    if (orderState.busy || orderState.locked) return;
    if (status === canonicalTaskState(task.estado)) return;
    if (!canUserMoveTaskToState(task, sesion?.usuario, status)) {
      onError(status === "finalizada"
        ? "No tenés permiso para completar esta tarea."
        : "No tenés permiso para mover esta tarea.");
      return;
    }
    if (status === "aprobada") {
      if (task.tipo_tarea === 'edicion' && task.propiedades_extra?.workspace === 'render_os') {
        void openTask(task.id, true);
        return 'review'; // Explicit review, never an optimistic board transition.
      }
      void onApprove(task).catch(() => {}); return 'approval';
    }
    void onUpdate(task.id, { estado: status }, `movió la tarea de ${STATUSES.find((item) => item.id === canonicalTaskState(task.estado))?.label || task.estado} a ${STATUSES.find((item) => item.id === status)?.label || status}`).catch(() => {});
    return 'move';
  }, [onError, onUpdate, onApprove, openTask, sesion?.usuario, orderState.busy, orderState.locked]);
  const openFeedback = useCallback(() => {
    if (!requestAppNavigation(window, "/feedback")) return;
    window.history.pushState({ ...window.history.state, fromTasks: window.location.href }, "", "/feedback");
    window.dispatchEvent(new PopStateEvent("popstate"));
  }, []);
  const clearFilters = () => { setQuery(""); setResponsible("all"); setClient("all"); setSector("all"); setPriority("all"); setArea("all"); setTaskStatus("all"); setReviewScope(''); };
  const changeTaskStatus = value => { if (value !== 'en_revision') setReviewScope(''); setTaskStatus(value); };
  const changeArchiveMode = value => { setReviewScope(''); setArchiveMode(value); };
  const exitReviewQueue = () => { setReviewScope(''); setTaskStatus('all'); };
  const selectMobileBoardColumn = useCallback((columnId) => {
    if (!BOARD_COLUMNS.some(column => column.id === columnId)) return;
    setMobileBoardColumn(columnId);
    window.requestAnimationFrame(() => mobileBoardNavRef.current?.scrollIntoView({ behavior: "auto", block: "start" }));
  }, []);
  const dropOnProcessButton = (event, column) => {
    if (!event.dataTransfer.types.includes('text/task-id')) return;
    event.preventDefault();
    setDragOver('');
    const task = tasksLatestRef.current.find(item => String(item.id) === event.dataTransfer.getData('text/task-id'));
    if (!task) return;
    const status = column.dropState || column.id;
    if (sort === 'manual' && effectiveTaskFilterState(task) !== canonicalTaskState(task.estado) && status === effectiveTaskFilterState(task)) return;
    if (sort === 'manual' && archiveMode === 'active' && canonicalTaskState(task.estado) === status) { if(manualReady&&canUserEditTask(task,sesion?.usuario))void onReorder(task,null); return; }
    if (!canUserMoveTask(task, sesion?.usuario)) return;
    const result = move(task, status);
    if ((result === 'move' || result === 'approval') && compactBoard && canUserMoveTaskToState(task, sesion?.usuario, status)) selectMobileBoardColumn(column.id);
  };
  const dropBeforeTask = (event, before) => {
    if (sort !== 'manual' || archiveMode !== 'active' || !event.dataTransfer.types.includes('text/task-id')) return;
    const task = tasksLatestRef.current.find(item => String(item.id) === event.dataTransfer.getData('text/task-id'));
    if (effectiveTaskFilterState(before) !== canonicalTaskState(before.estado) || task && effectiveTaskFilterState(task) !== canonicalTaskState(task.estado)) { event.preventDefault(); event.stopPropagation(); return; }
    if (!task || canonicalTaskState(task.estado) !== canonicalTaskState(before.estado)) return;
    event.preventDefault(); event.stopPropagation(); setDragOver('');
    if (manualReady && task.id !== before.id && canUserEditTask(task,sesion?.usuario)) void onReorder(task,before);
  };
  const orderControls = (task, items, index, visibleLimit = 250) => {
    if(sort !== 'manual' || archiveMode !== 'active' || !canUserEditTask(task,sesion?.usuario) || effectiveTaskFilterState(task) !== canonicalTaskState(task.estado))return undefined;
    const candidates=items.slice(0,visibleLimit).filter(item=>effectiveTaskFilterState(item)===canonicalTaskState(item.estado));
    const observedIndex=candidates.findIndex(item=>item.id===task.id);
    const up=taskOrderArrowAnchor(candidates,observedIndex,'up'),down=taskOrderArrowAnchor(candidates,observedIndex,'down');
    return {up:manualReady&&up!==undefined?()=>void onReorder(task,up):null,down:manualReady&&down!==undefined?()=>void onReorder(task,down):null,end:manualReady?()=>void onReorder(task,null):null};
  };

  const listWindow = taskVisibleWindow(visible, reviewScope ? Math.max(1,visible.length) : listLimit, 500);

  return <><section className="ros-page">
    <div className="ros-title-row"><div className="ros-title-copy"><span className="ros-page-emoji" aria-hidden="true">📋</span><div><h1>Tareas</h1><p>Organizá y priorizá el trabajo del equipo.</p></div></div><div className="ros-title-actions"><input className="ros-top-search" aria-label="Buscar tareas" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar tarea, cliente o responsable…"/><button className="ros-primary-button" type="button" onClick={() => setCreatingStatus("pendiente")}><TaskViewIcon name="plus"/>Nueva tarea</button></div></div>
    <div className="ros-controls"><div className="ros-primary-navigation" aria-label="Vistas de tareas"><div className="ros-view-tabs"><button aria-pressed={view === "board"} className={view === "board" ? "active" : ""} onClick={() => setView("board")}><TaskViewIcon name="board"/>Tablero</button><button aria-pressed={view === "list"} className={view === "list" ? "active" : ""} onClick={() => setView("list")}><TaskViewIcon name="list"/>Lista</button><button aria-pressed={view === "calendar"} className={view === "calendar" ? "active" : ""} onClick={() => setView("calendar")}><TaskViewIcon name="calendar"/>Calendario</button><button aria-pressed={view === "clients"} className={view === "clients" ? "active" : ""} onClick={() => setView("clients")}><TaskViewIcon name="clients"/>Por cliente</button><button aria-pressed={view === "responsibles"} className={view === "responsibles" ? "active" : ""} onClick={() => setView("responsibles")}><TaskViewIcon name="clients"/>Por responsable</button></div><button className={`ros-feedback-link ${newFeedbackCount ? "has-new" : ""}`} type="button" onClick={openFeedback}><TaskViewIcon name="feedback"/>Feedback{newFeedbackCount > 0 && <b aria-label={`${newFeedbackCount} feedbacks nuevos`}>{newFeedbackCount > 99 ? "99+" : newFeedbackCount}</b>}</button></div><div className="ros-controls-meta"><span>{pagingBlocked?`Cargadas ${visible.length} · total por actualizar`:`Cargadas ${visible.length} de ${totalTasks}`}</span>{archiveMode !== "active" && <button className="ros-archive-link" type="button" onClick={() => changeArchiveMode("active")}>← Volver a tareas activas</button>}{archiveMode !== "trash" && <button className="ros-archive-link" type="button" onClick={() => changeArchiveMode("trash")}>Papelera</button>}</div></div>
    {reviewScope && <section className="ros-warning-banner ros-review-queue" aria-label="Cola de revisión"><strong>{reviewScope === 'team' ? 'Revisión del equipo' : reviewScope === 'personal' ? 'Tu trabajo en revisión' : 'Cola de revisión no válida'}</strong><p>Mostrando {visible.length} de {totalTasks}. Tareas que esperan revisión; las aprobadas no se incluyen. Los demás filtros también se aplican. Al recargar se vuelve al principio.</p>{orderMessage && <p role="status">{orderMessage}</p>}<button type="button" disabled={loadingMore || orderState.busy || Boolean(queryNotice)} onClick={onRefreshReview}>Actualizar cola desde el principio</button>{view !== "list" && <button type="button" onClick={() => setView("list")}>Ver toda la cola en lista</button>}<button type="button" disabled={orderState.busy} onClick={exitReviewQueue}>Salir de la cola</button></section>}
    {queryNotice && <p className="ros-warning-banner" role="alert">{queryNotice}</p>}
    <div className="ros-order-toolbar"><FilterSelect label="Orden" aria-label="Orden de tareas" value={sort} disabled={orderState.busy} onChange={event=>setSort(event.target.value)}><option value="date">Fecha</option><option value="manual" disabled={Boolean(reviewScope)}>Manual</option></FilterSelect>{sort === 'manual' && view === 'board' && archiveMode === 'active' && <details className="ros-order-help"><summary>Orden compartido</summary><p>Soltá sobre una tarjeta para ubicar antes, o sobre la columna para mover al final. Las flechas usan tareas cargadas; «Al final» usa la columna completa.</p></details>}</div>
    {!reviewScope && (orderMessage || orderState.locked || pagingBlocked) && <div className="ros-warning-banner" role="status"><p>{orderMessage || 'Movimiento pendiente de confirmación.'}</p>{orderState.status === 'uncertain' && <button type="button" disabled={orderState.busy} onClick={onVerifyOrder}>Verificar movimiento</button>}<button type="button" disabled={orderState.busy} onClick={onRefreshOrder}>{orderState.locked ? 'Descartar intento y recargar primera página' : 'Recargar primera página'}</button></div>}
    {responsibleNotice && <p className="ros-warning-banner" role="status">{responsibleNotice}</p>}
    <button className="ros-filter-toggle" type="button" aria-expanded={filtersOpen} onClick={() => setFiltersOpen((current) => !current)}>Filtros{activeFilterCount ? <b>{activeFilterCount}</b> : null}<span>{filtersOpen ? "Ocultar" : "Mostrar"}</span></button>
    <div className={`ros-filter-bar ${filtersOpen ? "open" : ""}`}><FilterSelect label="Estado" aria-label="Filtrar por estado" value={taskStatus} onChange={(event) => changeTaskStatus(event.target.value)}>{taskStatus !== "all" && !STATUSES.some(item=>item.id===taskStatus) && <option value={taskStatus} disabled>Estado no válido</option>}<option value="all">Todos</option>{STATUSES.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</FilterSelect><FilterSelect label="Área" aria-label="Área" value={area} onChange={(event) => setArea(event.target.value)}><option value="all">Todas</option>{AREAS.slice(1).map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</FilterSelect><FilterSelect label="Responsable" aria-label="Responsable" value={responsible} onChange={(event) => setResponsible(event.target.value)}><option value="all">Todos</option>{responsibleNotice && <option value={responsible} disabled>Elegí un integrante</option>}{responsibleOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</FilterSelect><FilterSelect label="Cliente" aria-label="Cliente" value={client} onChange={(event) => setClient(event.target.value)}><option value="all">Todos</option><option value="none">Sin cliente</option>{clients.map((item) => <option key={item.id} value={String(item.id)}>{item.nombre}</option>)}</FilterSelect><FilterSelect label="Sector" aria-label="Sector" value={sector} onChange={(event) => setSector(event.target.value)}><option value="all">Todos</option><option value="none">Sin sector</option>{TASK_TYPES.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</FilterSelect><FilterSelect label="Prioridad" aria-label="Prioridad" value={priority} onChange={(event) => setPriority(event.target.value)}><option value="all">Todas</option><option value="alta">Alta</option><option value="media">Media</option><option value="baja">Baja</option></FilterSelect>{hasFilters && <button type="button" onClick={clearFilters}>Limpiar filtros</button>}</div>
    {view === "board" && <><nav ref={mobileBoardNavRef} className="ros-mobile-board-nav" aria-label="Estados del tablero">{BOARD_COLUMNS.map((column) => <button aria-pressed={mobileBoardColumn === column.id} className={`${mobileBoardColumn === column.id ? 'active' : ''} ${dragOver === column.id ? 'drag-over' : ''}`} key={column.id} type="button" onClick={() => selectMobileBoardColumn(column.id)}
      onDragOver={(event) => { if (!event.dataTransfer.types.includes('text/task-id')) return; event.preventDefault(); event.dataTransfer.dropEffect = 'move'; setDragOver(column.id); }}
      onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setDragOver(''); }}
      onDrop={(event) => dropOnProcessButton(event,column)}><i style={{ background: column.color }}/><span>{column.label}</span><b>{boardColumnCounts[column.id] || 0}</b></button>)}</nav>
      <div ref={boardRef} className="ros-board ros-board-four" style={{ gridTemplateColumns: compactBoard ? undefined : "repeat(5, minmax(220px, 1fr))" }}>{renderedBoardColumns.map((column) => {
        const items = visible.filter((task) => column.states.includes(effectiveTaskFilterState(task)));
        const windowed = taskVisibleWindow(items,columnLimits[column.id] ?? 250);
        return <section className={`ros-column ${mobileBoardColumn === column.id ? "is-mobile-active" : ""} ${dragOver === column.id ? "drag-over" : ""}`} key={column.id}
          onDragOver={(event) => { if (!event.dataTransfer.types.includes("text/task-id")) return; event.preventDefault(); setDragOver(column.id); }}
          onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setDragOver(""); }} onDrop={(event) => dropOnProcessButton(event,column)}>
          <header><span style={{ color: column.color }}>●</span><strong>{column.label}</strong><small>{items.length}</small></header>
          <div>{windowed.items.map((task,index) => <TaskCard key={task.id} task={task} users={users} user={sesion?.usuario} today={today} onOpen={openTask} onMove={move}
            canMove={canUserMoveTask(task, sesion?.usuario)} moveBlocked={orderState.busy||orderState.locked} onOrderDrop={sort==='manual'&&archiveMode==='active'?dropBeforeTask:undefined}
            manualControls={orderControls(task,items,index,windowed.limit)}/>)}
            {windowed.hasMore && <div className="ros-column-limit"><p>Mostrando {windowed.limit} de {items.length} tareas cargadas.</p><button type="button" disabled={orderState.busy||orderState.locked}
              aria-label={`Mostrar más tareas de ${column.label}`} onClick={()=>setColumnLimits(current=>({...current,[column.id]:windowed.nextLimit}))}>Mostrar más</button></div>}
            {items.length === 0 && <button className="ros-empty-column" type="button" onClick={() => setCreatingStatus(column.dropState || column.id)}><span>+</span>Nueva tarea</button>}
          </div>
        </section>;
      })}</div></>}
    {view === "list" && <div className="ros-task-list"><div className="ros-task-list-head"><span>TAREA</span><span>ÁREA</span><span>CLIENTE</span><span>RESPONSABLES</span><span>ESTADO</span><span>FECHA</span></div>
      {listWindow.items.map((task) => <button key={task.id} onClick={() => openTask(task.id)}><strong>{task.titulo}</strong><AreaBadge task={task}/><span>{task.cliente_nombre || "Sin cliente"}</span><span>{taskResponsiblesLabel(task, users)}</span><span>{STATUSES.find((item) => item.id === effectiveTaskFilterState(task))?.label || task.estado}</span><span>{formatDate(task.fecha_vencimiento)}</span></button>)}
      {listWindow.hasMore && <div className="ros-list-limit"><p>Mostrando {listWindow.limit} de {visible.length} tareas cargadas.</p><button type="button" disabled={orderState.busy||orderState.locked} onClick={()=>setListLimit(listWindow.nextLimit)}>Mostrar más tareas en lista</button></div>}
    </div>}
    {view === "calendar" && <TaskCalendar tasks={visible} users={users} onOpen={openTask} monthValue={calendarMonth} onMonthChange={setCalendarMonth}/>} {view === "clients" && <TasksByClient tasks={visible} users={users} onOpen={openTask}/>} {view === "responsibles" && <TasksByResponsible tasks={visible} users={users} onOpen={openTask}/>} {view !== "board" && visible.length === 0 && <div className="ros-no-results">{emptyMessage}</div>}
    {paginatedTaskCount < totalTasks && <div className="ros-load-more"><button type="button" disabled={loadingMore||pagingBlocked||orderState.busy||orderState.locked} onClick={onLoadMore}>{loadingMore ? "Cargando…" : `Cargar más tareas (${paginatedTaskCount} de ${totalTasks})`}</button></div>}
  </section>
  {selected && <TaskDetail key={selected.id} task={selected} tasks={tasks} users={users} clients={clients} sesion={sesion} reviewRequestedTaskId={reviewRequestedTaskId} onClose={closeTask} onOpen={openTask} onLoadSubtasks={loadSubtasks} onUpdate={onUpdate} onRegisterProduction={onRegisterProduction} onCorrectProduction={onCorrectProduction} onConfirmProduction={onConfirmProduction} onApprove={onApprove} onTrashAction={async (task, action) => { const guard = captureRequest(); guard.assertCurrent(); await onBulkAction([task.id], action); guard.assertCurrent(); closeTask(); }}/>}
  {creatingStatus && <NewTaskModal users={users} clients={clients} sesion={sesion} initialStatus={creatingStatus} onClose={() => setCreatingStatus(null)} onCreate={onCreate} onCreated={created => { setCreatingStatus(null); void openTask(created.id); }}/>}</>;
}

export function WorkspaceReadOnlyPage({ sesion }) {
  const captureRequest = useWorkspaceCapture(sesion);
  const initialViewState = useMemo(() => getTaskViewState(window.location.search), []);
  const [tasks, setTasks] = useState([]);
  const [clients, setClients] = useState([]);
  const [users, setUsers] = useState([]);
  const [catalogReady, setCatalogReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [totalTasks, setTotalTasks] = useState(0);
  const [error, setError] = useState("");
  const [toast, setToast] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [query, setQuery] = useState(initialViewState.query);
  const [area, setArea] = useState(initialViewState.area);
  const [responsible, setResponsible] = useState(initialViewState.responsible);
  const [client, setClient] = useState(initialViewState.client);
  const [sector, setSector] = useState(initialViewState.sector);
  const [priority, setPriority] = useState(initialViewState.priority);
  const [archiveMode, setArchiveMode] = useState(initialViewState.archiveMode);
  const [sort, setSort] = useState(initialViewState.sort);
  const [taskStatus, setTaskStatus] = useState(initialViewState.status);
  const [reviewScope, setReviewScope] = useState(initialViewState.reviewScope);
  const reviewScopeRef = useRef(reviewScope); reviewScopeRef.current = reviewScope;
  const reviewPageRef = useRef(null);
  const [orderReload, setOrderReload] = useState(0);
  const [orderPage, setOrderPage] = useState(null);
  const [pagingBlocked, setPagingBlocked] = useState(false);
  const [orderMessage, setOrderMessage] = useState('');
  const [, renderOrder] = useState(0);
  const queryNotice = taskQueryNotice({status:taskStatus,reviewScope,archiveMode,sort},sesion?.usuario?.rol);
  const effectiveSort = !reviewScope && sort === 'manual' && archiveMode === 'active' ? 'manual' : 'date';
  const orderContext = JSON.stringify([effectiveSort, sort, query, area, responsible, client, sector, priority, archiveMode, taskStatus, reviewScope]);
  const orderObservation = useMemo(() => ({context:orderContext}), [orderContext,captureRequest]);
  const orderContextRef = useRef(orderObservation); orderContextRef.current = orderObservation;
  const orderPageRef = useRef(null);
  const orderModel = useMemo(() => createTaskManualOrder({capture:captureRequest}), [captureRequest]);
  const orderState = orderModel.snapshot;
  const manualReady = !reviewScope && !queryNotice && effectiveSort === 'manual' && orderPage?.observation === orderObservation && !orderState.locked && !pagingBlocked;
  useNavigationGuard(() => captureRequest().current() ? {dirty:orderModel.snapshot.locked,busy:orderModel.snapshot.busy} : {dirty:false,busy:false});
  const tasksRef = useRef(tasks);
  const createdAdmissions=useRef({capture:captureRequest,ids:new Set()});
  if(createdAdmissions.current.capture!==captureRequest)createdAdmissions.current={capture:captureRequest,ids:new Set()};
  const updateQueuesRef = useRef(new Map());
  const taskQueryGenerationRef = useRef(0);
  const markReviewQueueStale = (guard, uncertain = false) => {
    guard.assertCurrent(); if (!reviewScopeRef.current) return;
    taskQueryGenerationRef.current++; reviewPageRef.current = null;
    setLoadingMore(false); setLoading(false); setError(''); setPagingBlocked(true);
    setOrderMessage(`${uncertain ? 'La cola puede haber cambiado.' : 'La cola cambió.'} El total corresponde a la consulta anterior; actualizá desde el principio para continuar.`);
  };
  const responsibleSelection = useMemo(() => resolveResponsibleFilter(responsible, users, catalogReady, sesion?.usuario?.rol === 'admin'), [responsible, users, catalogReady, sesion?.usuario?.rol]);
  useEffect(() => { tasksRef.current = tasks; }, [tasks]);

  useEffect(() => {
    const syncFilters = () => {
      const next = getTaskViewState(window.location.search);
      setQuery(next.query); setArea(next.area); setResponsible(next.responsible);
      setClient(next.client); setSector(next.sector); setPriority(next.priority); setArchiveMode(next.archiveMode); setSort(next.sort);
      setTaskStatus(next.status); setReviewScope(next.reviewScope);
    };
    window.addEventListener('popstate', syncFilters);
    return () => window.removeEventListener('popstate', syncFilters);
  }, []);

  useEffect(() => {
    if (responsibleSelection.status === 'resolved') setResponsible(responsibleSelection.value);
  }, [responsibleSelection.status, responsibleSelection.value]);

  useEffect(() => {
    let active = true;
    const guard = captureRequest(apiJson);
    setCatalogReady(false);
    Promise.all([guard.request("/api/clientes"), guard.request("/api/usuarios")])
      .then(([clientData, userData]) => {
        if (!active || !guard.current()) return;
        setClients(clientData);
        setUsers(userData);
        setCatalogReady(true);
      })
      .catch((reason) => { if (active && guard.current() && !isSessionFailure(reason)) setError(reason.message || "No se pudieron cargar los datos reales."); })
    return () => { active = false; };
  }, [reloadKey, captureRequest]);

  useEffect(() => {
    let active = true;
    const guard = captureRequest();
    const generation = ++taskQueryGenerationRef.current;
    setLoadingMore(false);
    orderPageRef.current = null; setOrderPage(null); setPagingBlocked(false);
    reviewPageRef.current = null;
    if (!responsibleSelection.ready || queryNotice) {
      if (queryNotice || responsibleSelection.status !== 'pending' && responsibleSelection.status !== 'resolved') {
        const contextId = Number(new URLSearchParams(window.location.search).get('task')) || null;
        // A blocked list filter is not permission to discard an open editor.
        setTasks(current => current.filter(task => task.id === contextId).map(task => ({ ...task, __renderOsDirectOnly: true })));
        setTotalTasks(0); setLoading(false);
        if (Number.isSafeInteger(contextId) && contextId > 0 && contextId <= 2147483647
          && !tasksRef.current.some(task => task.id === contextId)) {
          void guard.request(`/api/tareas/${contextId}?workspace=render_os`).then(task => {
            if (!active || !guard.current() || generation !== taskQueryGenerationRef.current
              || Number(new URLSearchParams(window.location.search).get('task')) !== contextId) return;
            setTasks([{ ...task, __renderOsDirectOnly: true }]);
          }).catch(reason => {
            if (!active || !guard.current() || isSessionFailure(reason) || generation !== taskQueryGenerationRef.current
              || Number(new URLSearchParams(window.location.search).get('task')) !== contextId) return;
            notify(reason.message || 'La tarea enlazada no está disponible.', 'error');
          });
        }
      }
      return () => { active = false; };
    }
    const timer = window.setTimeout(() => {
      if (!guard.current()) return;
      apiTaskPage({ offset: 0, query, area, responsible: responsibleSelection.value, client, sector, priority, archiveMode, sort: effectiveSort, status:taskStatus, reviewScope }, guard.options())
        .then(async (taskPage) => {
          if (!active || !guard.current() || generation !== taskQueryGenerationRef.current || orderContextRef.current !== orderObservation) return;
          let items = taskPage.items;
          const directTaskId = Number(new URLSearchParams(window.location.search).get("task")) || null;
          if (directTaskId && !items.some((task) => task.id === directTaskId)) {
            try {
              const directTask = await guard.request(`/api/tareas/${directTaskId}?workspace=render_os`);
              if (!active || !guard.current() || generation !== taskQueryGenerationRef.current
                || Number(new URLSearchParams(window.location.search).get('task')) !== directTaskId) return;
              items = mergeRelatedTasks(items, [{ ...directTask, __renderOsDirectOnly: true }]);
            } catch (reason) {
              if (!active || !guard.current() || isSessionFailure(reason) || generation !== taskQueryGenerationRef.current
                || Number(new URLSearchParams(window.location.search).get('task')) !== directTaskId) return;
              if (reviewScope && ![401,403,404].includes(reason?.status)) throw reason;
              notify(reason.message || "La tarea enlazada no está disponible.", "error");
              const url = new URL(window.location.href);
              url.searchParams.delete("task");
              window.history.replaceState(window.history.state, "", url);
              window.dispatchEvent(new PopStateEvent("popstate"));
            }
          }
          if (!active || !guard.current() || generation !== taskQueryGenerationRef.current || orderContextRef.current !== orderObservation) return;
          const metadata = effectiveSort === 'manual' ? {revision:taskPage.orderRevision,snapshot:taskPage.orderSnapshot,context:orderContext,observation:orderObservation} : null;
          orderPageRef.current = metadata; setOrderPage(metadata);
          reviewPageRef.current = reviewScope ? {snapshot:taskPage.reviewSnapshot,total:taskPage.total,observation:orderObservation} : null;
          setTasks(items);
          setTotalTasks(taskPage.total);
          setError("");
        })
        .catch((reason) => {
          if (!active || !guard.current() || generation !== taskQueryGenerationRef.current || orderContextRef.current !== orderObservation || isSessionFailure(reason)) return;
          if (reviewScope && ![401,403].includes(reason?.status)) {
            setPagingBlocked(true); setOrderMessage(reason.message || 'No se pudo actualizar la cola. Conservamos la tarea abierta y los datos observados.');
          } else setError(reason.message || "No se pudieron cargar las tareas.");
        })
        .finally(() => { if (active && guard.current() && generation === taskQueryGenerationRef.current && orderContextRef.current === orderObservation) setLoading(false); });
    }, query ? 250 : 0);
    return () => { active = false; window.clearTimeout(timer); };
  }, [query, area, responsibleSelection.ready, responsibleSelection.status, responsibleSelection.value, client, sector, priority, archiveMode, taskStatus, reviewScope, queryNotice, effectiveSort, orderContext, orderObservation, orderReload, reloadKey, captureRequest]);

  useEffect(() => {
    const guard = captureRequest();
    const incorporate = (event) => {
      if (!guard.current()) return;
      const items = Array.isArray(event.detail) ? event.detail : [];
      if (items.some(item=>tasksRef.current.some(current=>current.id===item.id&&current.revision!==item.revision))) markReviewQueueStale(guard);
      setTasks((current) => mergeRelatedTasks(current, items));
    };
    window.addEventListener("render-os:related-tasks", incorporate);
    return () => window.removeEventListener("render-os:related-tasks", incorporate);
  }, [captureRequest]);

  const loadMoreTasks = async () => {
    const guard = captureRequest();
    if (!guard.current()) return;
    const generation = taskQueryGenerationRef.current;
    const paginatedTaskCount = tasks.filter((task) => !task.__renderOsDirectOnly).length;
    if (!responsibleSelection.ready || queryNotice || loadingMore || pagingBlocked || orderState.busy || paginatedTaskCount >= totalTasks) return;
    const manualPage = orderPageRef.current;
    const reviewPage = reviewPageRef.current;
    if (reviewScope && reviewPage?.observation !== orderObservation) return;
    if (effectiveSort === 'manual' && manualPage?.observation !== orderObservation) return;
    setLoadingMore(true);
    try {
      const page = await apiTaskPage({ offset: paginatedTaskCount, query, area, responsible: responsibleSelection.value, client, sector, priority, archiveMode, sort: effectiveSort, status:taskStatus, reviewScope, ...(reviewScope ? {expectedReviewSnapshot:reviewPage.snapshot} : {}), ...(effectiveSort === 'manual' ? {expectedSnapshot:manualPage.snapshot} : {}) }, guard.options());
      guard.assertCurrent();
      if (generation !== taskQueryGenerationRef.current) return;
      if (orderContextRef.current !== orderObservation) return;
      if (reviewScope && (page.reviewSnapshot !== reviewPage.snapshot || page.total !== reviewPage.total || page.items.some(item=>tasks.some(task=>!task.__renderOsDirectOnly&&task.id===item.id)))) throw Object.assign(new Error('La cola cambió. Actualizala desde el principio.'),{status:409});
      if (effectiveSort === 'manual' && (page.orderRevision !== manualPage.revision || page.orderSnapshot !== manualPage.snapshot)) throw Object.assign(new Error('El orden cambió. Recargá la primera página.'), {status:409});
      if (effectiveSort === 'manual' && (page.total !== totalTasks || page.items.some(item=>tasks.some(task=>!task.__renderOsDirectOnly&&task.id===item.id)))) throw Object.assign(new Error('La página no coincide con la colección observada. Recargá la primera página.'), {status:409});
      setTasks((current) => {
        if (!guard.current() || generation !== taskQueryGenerationRef.current || orderContextRef.current !== orderObservation) return current;
        const pageIds = new Set(page.items.map((item) => item.id));
        const retained = current.filter((task) => !task.__renderOsDirectOnly || !pageIds.has(task.id));
        return [...retained, ...page.items.filter((item) => !retained.some((task) => task.id === item.id))];
      });
      setTotalTasks(page.total);
    } catch (reason) {
      if (guard.current() && !isSessionFailure(reason) && generation === taskQueryGenerationRef.current && orderContextRef.current === orderObservation) {
        if (effectiveSort === 'manual' || reviewScope) { setPagingBlocked(true); setOrderMessage(reason.message || 'No se pudo verificar la continuación. Recargá la primera página.'); }
        else notify(reason.message || "No se pudieron cargar más tareas.", "error");
      }
    } finally {
      if (guard.current() && generation === taskQueryGenerationRef.current && orderContextRef.current === orderObservation) setLoadingMore(false);
    }
  };

  const refreshReviewQueue = () => {
    const guard = captureRequest();
    if (!guard.current() || !reviewScope || orderModel.snapshot.busy) return;
    // Reuse the app's cancelable unsaved-work protocol even though this is
    // an explicit same-location refresh, not a history navigation.
    const before = new CustomEvent('render:before-navigation',{detail:{href:window.location.href,type:'refresh'},cancelable:true});
    if (!window.dispatchEvent(before)) return;
    guard.assertCurrent(); taskQueryGenerationRef.current++; reviewPageRef.current = null;
    setLoadingMore(false); setPagingBlocked(false); setOrderMessage(''); setOrderReload(value=>value+1);
  };

  const reloadTaskOrder = () => {
    taskQueryGenerationRef.current++; orderPageRef.current = null;
    setOrderPage(null); setLoadingMore(false); setPagingBlocked(false); setOrderReload(value => value + 1);
  };
  const refreshTaskOrder = () => {
    const guard = captureRequest(); if (!guard.current() || orderModel.snapshot.busy) return;
    orderModel.reset(); setOrderMessage(''); renderOrder(value => value + 1); reloadTaskOrder();
  };
  const reorderTask = async (task, before = null, verify = false) => {
    const guard = captureRequest();
    if (!guard.current() || orderModel.snapshot.busy) return;
    if (!verify && (orderContextRef.current !== orderObservation || !manualReady || !canUserEditTask(task, sesion?.usuario))) return;
    const page = orderPageRef.current;
    if (!verify && page?.observation !== orderObservation) return;
    try {
      const pending = verify ? orderModel.verify() : orderModel.move({task,before,orderRevision:page.revision});
      setOrderMessage(''); renderOrder(value => value + 1);
      await pending; guard.assertCurrent();
      setOrderMessage('Orden guardado. Cargando la primera página actual.'); reloadTaskOrder();
    } catch (reason) {
      if (guard.current() && !isSessionFailure(reason)) setOrderMessage(orderModel.snapshot.status === 'conflict'
        ? 'El orden o la tarea cambió. Conservamos el intento; recargá explícitamente y revisá antes de mover otra vez.'
        : reason.message || 'No se pudo confirmar el orden. Verificá el mismo movimiento.');
    } finally { if (guard.current()) renderOrder(value => value + 1); }
  };

  const notify = (message, type = "success") => {
    const guard = captureRequest();
    if (!guard.current()) return;
    setToast({ message, type }); window.clearTimeout(window.__rosToastTimer);
    window.__rosToastTimer = window.setTimeout(() => { if (guard.current()) setToast(null); }, 3500);
  };
  const logActivity = (taskId, message, guard) => guard.request(`/api/tareas/${taskId}/comentarios?workspace=render_os`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ autor: sesion?.usuario?.nombre || sesion?.usuario?.usuario || "Equipo RENDER", contenido: `[Actividad] ${message}` }) });
  const updateTask = (id, changes, activity, observedRevision = null) => {
    const guard = captureRequest();
    changes = JSON.parse(JSON.stringify(changes));
    const requiresReviewObservation = ["aprobada", "finalizada", "publicada"].includes(changes.estado);
    if (requiresReviewObservation && observedRevision === null) observedRevision = tasksRef.current.find((task) => task.id === id)?.revision ?? null;
    const run = async () => {
      guard.assertCurrent();
      const previous = tasksRef.current.find((task) => task.id === id);
      if (!previous) throw new Error("La tarea ya no está disponible.");
      if ((requiresReviewObservation && !Number.isSafeInteger(observedRevision)) || (observedRevision !== null && previous.revision !== observedRevision)) throw Object.assign(new Error("La tarea cambió desde la revisión. Actualizá y revisá el trabajo antes de aprobar o finalizar."), { status: 409 });
      setTasks((current) => current.map((task) => task.id === id ? { ...task, ...changes } : task));
      try {
        const updated = await guard.request(`/api/tareas/${id}?workspace=render_os`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...changes, expected_revision: previous.revision, expected_updated_at: previous.updated_at || undefined }) });
        guard.assertCurrent();
        markReviewQueueStale(guard);
        const selectedClient = clients.find((item) => String(item.id) === String(updated.cliente_id));
        const complete = { ...previous, ...updated, cliente_nombre: selectedClient?.nombre || null };
        tasksRef.current = tasksRef.current.map((task) => task.id === id ? complete : task);
        setTasks((current) => current.map((task) => task.id === id ? complete : task));
        let historyFailed = false;
        if (activity) {
          try { await logActivity(id, activity, guard); }
          catch (historyError) { if (isSessionFailure(historyError)) throw historyError; historyFailed = true; }
        }
        guard.assertCurrent();
        notify(historyFailed ? "Cambio guardado, pero no se pudo registrar la actividad." : "Cambio guardado en la tarea real.", historyFailed ? "error" : "success");
        return complete;
      } catch (reason) {
        if (!guard.current() || isSessionFailure(reason)) throw reason;
        if (![400,401,403].includes(reason?.status)) markReviewQueueStale(guard, true);
        if (reason.status === 409) {
          let currentTask = null;
          try {
            currentTask = await guard.request(`/api/tareas/${id}?workspace=render_os`);
            guard.assertCurrent();
            if (!requiresReviewObservation && observedRevision === null && canRetryTaskUpdate(previous, currentTask, changes)) {
              const retried = await guard.request(`/api/tareas/${id}?workspace=render_os`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...changes, expected_revision: currentTask.revision, expected_updated_at: currentTask.updated_at || undefined }) });
              guard.assertCurrent();
              markReviewQueueStale(guard);
              const selectedClient = clients.find((item) => String(item.id) === String(retried.cliente_id));
              const complete = { ...currentTask, ...retried, cliente_nombre: selectedClient?.nombre || currentTask.cliente_nombre || null };
              tasksRef.current = tasksRef.current.map((task) => task.id === id ? complete : task);
              setTasks((current) => current.map((task) => task.id === id ? complete : task));
              let historyFailed = false;
              if (activity) {
                try { await logActivity(id, activity, guard); }
                catch (historyError) { if (isSessionFailure(historyError)) throw historyError; historyFailed = true; }
              }
              guard.assertCurrent();
              notify(historyFailed ? "Cambio guardado, pero no se pudo registrar la actividad." : "Cambio guardado en la tarea real.", historyFailed ? "error" : "success");
              return complete;
            }
            tasksRef.current = tasksRef.current.map((task) => task.id === id ? currentTask : task);
            setTasks((current) => current.map((task) => task.id === id ? currentTask : task));
          } catch (refreshError) {
            if (!guard.current() || isSessionFailure(refreshError)) throw refreshError;
            if (currentTask) {
              tasksRef.current = tasksRef.current.map((task) => task.id === id ? currentTask : task);
              setTasks((current) => current.map((task) => task.id === id ? currentTask : task));
            } else if (observedRevision !== null && ![401,403,404].includes(refreshError?.status)) {
              // A failed conflict refresh is not proof that the task vanished.
              // Keep the strict editor mounted on its original observation;
              // never adopt another revision or retry this draft implicitly.
              tasksRef.current = tasksRef.current.map((task) => task.id === id ? previous : task);
              setTasks((current) => current.map((task) => task.id === id ? previous : task));
            } else {
              setTasks((current) => current.filter((task) => task.id !== id));
            }
          }
        } else {
          tasksRef.current = tasksRef.current.map((task) => task.id === id ? previous : task);
          setTasks((current) => current.map((task) => task.id === id ? previous : task));
        }
        notify(reason.message || "No se pudo guardar el cambio.", "error");
        throw reason;
      }
    };
    const previousQueue = updateQueuesRef.current.get(id) || Promise.resolve();
    const queued = previousQueue.catch(() => {}).then(run);
    updateQueuesRef.current.set(id, queued);
    void queued.finally(() => { if (updateQueuesRef.current.get(id) === queued) updateQueuesRef.current.delete(id); }).catch(() => {});
    return queued;
  };
  const createTask = async (draft, {scope,method='POST'} = {}) => {
    const guard = scope||captureRequest();
    try {
      guard.assertCurrent();
      if(!draft?.request_id||!['POST','GET'].includes(method))throw new Error('Falta el intento de creación verificable.');
      const value=await guard.request(method==='GET'?`/api/tareas/creaciones/${draft.request_id}`:'/api/tareas',
        method==='GET'?{method:'GET',cache:'no-store'}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(draft)});
      guard.assertCurrent();
      const ack=parseTaskCreationAck(value,draft.request_id),created=ack.task;
      if(createdAdmissions.current.ids.has(created.id))return{...ack,task:tasksRef.current.find(task=>task.id===created.id)||created};
      const client = clients.find((item) => String(item.id) === String(created.cliente_id));
      const existing=tasksRef.current.find(task=>task.id===created.id);
      const complete = { ...created, cliente_nombre: client?.nombre || null, __renderOsDirectOnly:existing?existing.__renderOsDirectOnly===true:true };
      const first=!createdAdmissions.current.ids.has(created.id);
      if(first){
        createdAdmissions.current.ids.add(created.id);markReviewQueueStale(guard);
        if(!reviewScopeRef.current){
          taskQueryGenerationRef.current++;setLoadingMore(false);setPagingBlocked(true);
          setOrderMessage('La tarea está guardada. Recargá la primera página para actualizar el total y continuar la consulta.');
        }
      }
      tasksRef.current=[complete,...tasksRef.current.filter(task=>task.id!==created.id)];
      setTasks((current) => [complete,...current.filter(task=>task.id!==created.id)]);
      if(first&&!ack.operation.replayed&&method==='POST')try {
        await logActivity(created.id, draft.tarea_padre_id ? `creó esta subtarea dentro de la tarea #${draft.tarea_padre_id}` : "creó y asignó la tarea desde RENDER OS", guard);
        guard.assertCurrent();
        notify(draft.tarea_padre_id ? "Subtarea creada." : "Tarea creada y asignada.");
      } catch (historyError) {
        if (!guard.current() || isSessionFailure(historyError)) throw historyError;
        notify("Tarea creada, pero no se pudo registrar la actividad.", "error");
      }
      return {...ack,task:complete};
    } catch (reason) {
      if (!guard.current() || isSessionFailure(reason)) throw reason;
      if (![400,401,403].includes(reason?.status)) markReviewQueueStale(guard, true);
      notify(reason.message || "No se pudo crear la tarea.", "error");
      throw reason;
    }
  };
  const productionTaskSnapshot = (task) => {
    // CAS must describe the version the user saw, never a silent rebase from tasksRef.
    const snapshot = task;
    if (!Number.isSafeInteger(snapshot.revision) || snapshot.revision < 1) throw new Error("Recargá la tarea antes de modificar la producción: falta su revisión actual.");
    return snapshot;
  };
  const refreshProductionConflict = async (task, guard) => {
    try {
      const currentTask = await guard.request(`/api/tareas/${task.id}?workspace=render_os`);
      guard.assertCurrent();
      const refreshed = { ...task, ...currentTask };
      tasksRef.current = tasksRef.current.map((item) => item.id === task.id ? refreshed : item);
      setTasks((current) => current.map((item) => item.id === task.id ? refreshed : item));
      notify("La producción cambió. Recargamos la tarea; conservamos tus datos ingresados. Revisá el avance antes de volver a enviar.", "error");
    } catch (reason) {
      if (!guard.current() || isSessionFailure(reason)) throw reason;
      notify("La producción cambió y no se pudo recargar. Conservamos tus datos ingresados; recargá la tarea antes de volver a enviar.", "error");
    }
  };
  const registerProduction = async (task, cantidad, fecha, finalizar = false) => {
    const guard = captureRequest();
    try {
      guard.assertCurrent();
      const snapshot = productionTaskSnapshot(task);
      const updated = await guard.request(`/api/tareas/${task.id}/produccion/registros?workspace=render_os`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cantidad, fecha, finalizar, expected_revision: snapshot.revision, expected_updated_at: snapshot.updated_at || undefined }),
      });
      guard.assertCurrent();
      markReviewQueueStale(guard);
      const complete = { ...snapshot, ...updated, cliente_nombre: snapshot.cliente_nombre || null };
      tasksRef.current = tasksRef.current.map((item) => item.id === task.id ? complete : item);
      setTasks((current) => current.map((item) => item.id === task.id ? complete : item));
      notify(`${cantidad} video${cantidad === 1 ? "" : "s"} registrado${cantidad === 1 ? "" : "s"} en la visita.`);
      return complete;
    } catch (reason) {
      if (!guard.current() || isSessionFailure(reason)) throw reason;
      if (![400,401,403].includes(reason?.status)) markReviewQueueStale(guard, true);
      if (reason.status === 409) await refreshProductionConflict(task, guard);
      else notify(reason.message || "No se pudo registrar la grabación.", "error");
      throw reason;
    }
  };
  const confirmProduction = async (task) => {
    const guard = captureRequest();
    try {
      guard.assertCurrent();
      const snapshot = productionTaskSnapshot(task);
      const result = await guard.request(`/api/tareas/${task.id}/produccion/confirmar?workspace=render_os`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expected_revision: snapshot.revision }) });
      guard.assertCurrent();
      markReviewQueueStale(guard);
      const updated = { ...snapshot, ...result.task, cliente_nombre: snapshot.cliente_nombre || null };
      const additions = result.editing_task ? [{ ...result.editing_task, cliente_nombre: task.cliente_nombre || null }] : [];
      tasksRef.current = mergeRelatedTasks(tasksRef.current.map((item) => item.id === task.id ? updated : item), additions);
      setTasks((current) => mergeRelatedTasks(current.map((item) => item.id === task.id ? updated : item), additions));
      notify("Grabación confirmada. La edición se asigna por video desde Producciones.");
      return updated;
    } catch (reason) {
      if (!guard.current() || isSessionFailure(reason)) throw reason;
      if (![400,401,403].includes(reason?.status)) markReviewQueueStale(guard, true);
      if (reason.status === 409) await refreshProductionConflict(task, guard);
      else notify(reason.message || "No se pudo confirmar la grabación.", "error");
      throw reason;
    }
  };
  const correctProduction = async (task, record, cantidad) => {
    const guard = captureRequest();
    guard.assertCurrent();
    if (!Number.isInteger(cantidad) || cantidad <= 0) {
      notify("Ingresá una cantidad válida mayor que cero.", "error");
      return null;
    }
    try {
      const snapshot = productionTaskSnapshot(task);
      const updated = await guard.request(`/api/tareas/${task.id}/produccion/registros/${record.id}?workspace=render_os`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cantidad, expected_revision: snapshot.revision }),
      });
      guard.assertCurrent();
      markReviewQueueStale(guard);
      const complete = { ...snapshot, ...updated, cliente_nombre: snapshot.cliente_nombre || null };
      tasksRef.current = tasksRef.current.map((item) => item.id === task.id ? complete : item);
      setTasks((current) => current.map((item) => item.id === task.id ? complete : item));
      notify(`Registro corregido de ${record.cantidad} a ${cantidad} videos.`);
      return complete;
    } catch (reason) {
      if (!guard.current() || isSessionFailure(reason)) throw reason;
      if (![400,401,403].includes(reason?.status)) markReviewQueueStale(guard, true);
      if (reason.status === 409) await refreshProductionConflict(task, guard);
      else notify(reason.message || "No se pudo corregir el registro.", "error");
      throw reason;
    }
  };
  const approveTask = async (task, responsable_publicacion_id, review = null) => {
    const guard = captureRequest();
    try {
      guard.assertCurrent();
      const usesDelivery = task.tipo_tarea === 'edicion' && task.propiedades_extra?.workspace === 'render_os';
      if (usesDelivery && (!review || review.revision !== task.revision)) throw new Error("Actualizá el historial y revisá la versión antes de aprobar.");
      const deliveryPrecondition = review?.deliveryId ? { expected_entrega_id: review.deliveryId } : {};
      if (responsable_publicacion_id === undefined) return await updateTask(task.id, { estado: "aprobada", ...deliveryPrecondition }, "aprobó la revisión de la tarea", review?.revision ?? task.revision);
      if (!isTaskEditorialContext(task)) throw new Error('Esta tarea se aprueba sin responsable de publicación.');
      const publisher = users.find((user) => user.id === responsable_publicacion_id && ["admin", "community"].includes(user.rol));
      if (responsable_publicacion_id !== undefined && (!Number.isSafeInteger(responsable_publicacion_id) || responsable_publicacion_id <= 0 || !publisher)) throw new Error("Elegí un responsable de publicación válido.");
      const responsable_publicacion = publisher?.nombre;
      const updated = await guard.request(`/api/tareas/${task.id}/aprobar-publicacion?workspace=render_os`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ responsable_publicacion_id, expected_revision: review?.revision ?? task.revision, ...deliveryPrecondition }) });
      guard.assertCurrent();
      markReviewQueueStale(guard);
      const complete = { ...task, ...updated, cliente_nombre: task.cliente_nombre || null };
      tasksRef.current = tasksRef.current.map((item) => item.id === task.id ? complete : item);
      setTasks((current) => current.map((item) => item.id === task.id ? complete : item));
      try { await logActivity(task.id, publisher ? `aprobó el material y lo envió a ${responsable_publicacion}` : "aprobó la revisión de la tarea", guard); }
      catch (historyError) { if (isSessionFailure(historyError)) throw historyError; /* La aprobación ya quedó guardada. */ }
      guard.assertCurrent();
      notify(publisher ? `Tarea aprobada y enviada a ${responsable_publicacion}.` : "Revisión aprobada.");
      return complete;
    } catch (reason) {
      if (!guard.current() || isSessionFailure(reason)) throw reason;
      if (![400,401,403].includes(reason?.status)) markReviewQueueStale(guard, true);
      notify(reason.message || "No se pudo aprobar la tarea.", "error");
      throw reason;
    }
  };
  const bulkTaskAction = async (ids, action) => {
    const guard = captureRequest();
    try {
      const result = await guard.request("/api/tareas/acciones-masivas?workspace=render_os", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids, accion: action }),
      });
      guard.assertCurrent();
      const affected = new Set(result.ids || []);
      markReviewQueueStale(guard);
      setTasks((current) => current.filter((task) => !affected.has(task.id)));
      if (!reviewScopeRef.current) setTotalTasks((current) => Math.max(0, current - affected.size));
      const message = action === "papelera"
          ? `${affected.size} ${affected.size === 1 ? "tarea enviada" : "tareas enviadas"} a Papelera.`
          : `${affected.size} ${affected.size === 1 ? "tarea restaurada" : "tareas restauradas"}.`;
      notify(message);
      return result;
    } catch (reason) {
      if (!guard.current() || isSessionFailure(reason)) throw reason;
      if (![400,401,403].includes(reason?.status)) markReviewQueueStale(guard, true);
      notify(reason.message || "No se pudo completar la acción masiva.", "error");
      throw reason;
    }
  };

  const retry = () => { setError(""); setLoading(true); setReloadKey((current) => current + 1); };
  return <div className="render-workspace"><Toast toast={toast} onClose={() => setToast(null)}/><main className="ros-main">{loading || error ? <LoadingState error={error} onRetry={retry}/> : <TasksView tasks={tasks} totalTasks={totalTasks} loadingMore={loadingMore} onLoadMore={loadMoreTasks} users={users} clients={clients} query={query} setQuery={setQuery} area={area} setArea={setArea} responsible={responsible} setResponsible={setResponsible} client={client} setClient={setClient} sector={sector} setSector={setSector} priority={priority} setPriority={setPriority} archiveMode={archiveMode} setArchiveMode={setArchiveMode} sort={sort} setSort={setSort} taskStatus={taskStatus} setTaskStatus={setTaskStatus} reviewScope={reviewScope} setReviewScope={setReviewScope} queryNotice={queryNotice} onRefreshReview={refreshReviewQueue} manualReady={manualReady} orderState={orderState} orderMessage={orderMessage} onReorder={reorderTask} onVerifyOrder={()=>void reorderTask(null,null,true)} onRefreshOrder={refreshTaskOrder} pagingBlocked={pagingBlocked} sesion={sesion} onCreate={createTask} onUpdate={updateTask} onRegisterProduction={registerProduction} onCorrectProduction={correctProduction} onConfirmProduction={confirmProduction} onApprove={approveTask} onBulkAction={bulkTaskAction} onError={(message) => notify(message, "error")}/>}</main></div>;
}
