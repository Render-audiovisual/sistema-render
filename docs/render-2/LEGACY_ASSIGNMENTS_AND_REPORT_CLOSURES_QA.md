# Asignaciones históricas y cierres de Reportes — 2026-10-26

## Alcance y decisión humana

Se resuelven en la copia aislada los dos problemas identificados en ISOLATED_UPGRADE_REHEARSAL_QA.md. No se conecta, migra, sobrescribe ni despliega producción. Se conservan el respaldo inmutable y la primera restauración verificada.

El usuario confirma explícitamente las correspondencias con las cuentas individuales existentes y que las62 tareas de Líder permanezcan en su cuenta compartida actual, sin repartirlas entre Franco y Agustín. La cuenta existente de Franco Romero en Desarrollo no se convierte en dueño ni se identifica con el director audiovisual. No se cambian roles, credenciales ni usuarios. Esta confirmación resuelve el alcance de asignaciones, no certifica que existan dos cuentas de dueños independientes.

## Conciliación por ID

Nuevo módulo offline `backend/src/legacy-assignment-reconciliation.js`. No endpoint, autenticación por nombre ni backfill automático. Entradas cerradas con IDs explícitos: tarea, responsable y colaboradores. Plan de solo lectura con identidad PostgreSQL exacta, elecciones ordenadas, hash del registro completo de cada tarea y snapshot de usuarios seleccionados. SHA256 de todo el plan, incluida su identidad y entorno; el operador debe aprobar ese hash exacto.

Apply admite únicamente development/sandbox/test en loopback, verifica la conexión antes de locks, abre transacción SERIALIZABLE con tiempos acotados y toma lock breve de `tarea_asignaciones` antes del primer snapshot. Luego advisory lock, tareas ordenadas FOR UPDATE y usuarios ordenados FOR SHARE. Revalida tareas, usuarios activos/épocas/roles y ausencia de asignaciones existentes. Un único INSERT masivo crea las membresías. Nunca UPDATE de tareas, propiedades, nombres, estados, fechas, usuarios ni piezas. Error, conflicto, cuenta inactiva, plan alterado o intento repetido abortan todo, sin retry automático ni sustitución de asignaciones.

La tabla se bloquea para excluir inserciones directas ajenas al protocolo habitual de lock de tarea. Puede producir espera/deadlock con otra operación: falla y revierte, no reintenta ni ignora el conflicto. Es herramienta offline de conciliación de copia, no migrador productivo.

## Aplicación real sobre la copia autorizada

Copia `/private/tmp/render2-upgrade-LZZ5OA`, identidad `render2_upgrade_test`/`render_rehearsal`/127.0.0.1:55998, marcador y directorio PostgreSQL verificados. PostgreSQL sin salida de red, ruta propia. No fuente de producción ni proveedores.

Plan humano aprobado SHA256 `82861ad6dcf0d030a892ade9ffbd15602cb8488994c12ace562aac15f02d4ca3`. Se comprueba que cada elección coincide con la correspondencia aprobada y cada colaboración histórica, sin normalizar nombres nuevos ni asumir cuentas.

- 338 tareas conciliadas:338 responsables y12 colaboraciones,350 vínculos.
- Las62 tareas de Líder conservan su única cuenta actual; no reparto ni cambio de rol.
- Solo cambia `tarea_asignaciones`. Las otras110 tablas permanecen físicamente idénticas por hash de JSON+xmin+ctid, incluidos usuarios, tareas, cierres, clientes, publicaciones, ledger y datos financieros.
- Repetir el mismo plan devuelve conflicto sin cambiar una fila.
- Se detiene y reinicia el cluster propio:350 vínculos conservados, verificados individualmente contra el plan.
- Modelo real de Inicio para las8 cuentas: conteos comparados con SQL independiente de visibilidad/membresía; cada tarea de la lista tiene el ID de miembro correcto. Se respetan RenderOS, archivado, papelera y cliente activo: no se cambia workspace para forzar aparición de registros históricos.
- Snapshot real de Reportes para esas8 cuentas refleja los responsables/colaboradores correctos y los3 cierres conservados. No se inicia sesión ni se cambia contraseña de esos usuarios; esta parte comprueba los modelos del servidor con sus identidades de la copia, no logins reales ni dispositivos externos.
- Backend/PostgreSQL propios detenidos al terminar. Evidencia privada fuera de Git: `draft-assignment-plan.private.json`, `assignment-approval.private.json`, `assignment-application.private.json`, `assignment-restart-verification.private.json`.

## Cierres mensuales históricos

`historical-report-closures.js` detecta la tabla heredada con `to_regclass` dentro del mismo snapshot de Reportes. Instalación fresca sin archivo histórico devuelve disponible:false; tabla existente vacía devuelve disponible:true y lista vacía. Errores reales no se disfrazan de archivo vacío.

Proyección cerrada: período YYYY-MM-01, usuario_id, nombre_snapshot, porcentaje entero0–100 y registrado_at válido o null. No expone motivo, autorizado_por, importes ni JSON libre. El nombre es una etiqueta histórica, nunca una fuente de identidad. Se muestran todos los períodos del archivo, separados del rango operativo seleccionado; no reemplaza métricas ni cuotas, no completa tareas y no acredita publicaciones. Se conserva el estado original de las piezas.

`report-snapshot.js` lee el archivo mediante el cliente de la transacción RR READ ONLY ya autenticada; `report-access.js` vuelve a cerrar el DTO para los roles operativos autorizados, incluidos dueños. El frontend valida su forma, distingue archivo no verificable/no disponible/vacío y usa ReportTable responsive para mostrar filas o tarjetas por mes y persona/ID. No nueva migración histórica ni DML de cierres.

HTTP canónico contra la copia restaurada comprueba los3 cierres de septiembre existentes por ID/porcentaje, sesiones sintéticas independientes, rechazo financiero de empleado, datos operativos sin campos privados comprobados, creación/replay/edición CAS y fecha conservada tras nueva sesión+SQL. Los64 conjuntos originales siguen por conteo/hash igual al respaldo. Este HTTP precede la conciliación; las comprobaciones posteriores al reinicio se detallan arriba.

## Pruebas y revisión

- Backend completo:2.722PASS/179opt-inSKIP/0FAIL de2.901; `/private/tmp/render-compat-backend-final3.log`.
- Frontend completo:3.335PASS/1opt-inSKIP/0FAIL de3.336; `/private/tmp/render-compat-frontend-final.log`.
- Cohorte principal40archivos:359PASS/0FAIL/0SKIP,105,20s; `/private/tmp/render-compat-core-final.log`. Incluye el nuevo recorrido de compatibilidad sobre fixture descartable, nunca la base comercial.
- Build correcto: `index-MhFIu74X.js`; `/private/tmp/render-compat-build-final.log`.
- 12 pruebas unitarias independientes de conciliación y pruebas DTO/snapshot/frontend: entradas inválidas, plan alterado, usuario cambiado/inactivo, rollback, conflicto, ausencia de sobrescritura y snapshot capturado antes del lease.
- Recorrido físico nuevo: plan read-only, tarea cambiada antes de aplicar, inserción atómica de responsable+colaborador, repetición rechazada e invariancia física de las demás tablas. Inserción directa READ COMMITTED forzada entre preflight y lock de tabla se observa en el primer snapshot y cancela la conciliación sin sobrescribirla.
- Reporte HTTP de dueño y empleado muestra cierres sintéticos con mismo nombre pero IDs distintos; notas privadas no salen, estado pendiente y publicaciones permanecen iguales, todas las lecturas invariantes.
- Navegador real IAB, login de empleado sintético y build MhFIu74X: escritorio1280×900, móvil390×844 y320×844. Tabla se adapta a tarjetas; scrollWidth=clientWidth en las tres medidas, recarga conserva ambos meses. Baseline posterior al login de110 tablas físicamente invariante al cerrar, fixture eliminado, viewport restaurado y pestaña propia cerrada. `NATIVE_CLOSURES_FINAL_OK`, terminal0 en `/private/tmp/render-closures-native-qa-final.log`. Captura local de datos sintéticos: `/private/tmp/render-closures-verified-desktop.png`.

Intentos iniciales no se cuentan como verdes: doubles de snapshot no conocían la nueva lectura opcional; se actualizan manteniendo assertions de privacidad. El contador del runner de QA cambia39→40 y sus42 argumentos se verifica explícitamente. El primer fixture visual carecía de stdin persistente: se aborta limpiamente/ENOENT, se repite con TTY y solo la segunda ejecución acepta invariancia. No se ocultan esos fallos mediante skips.

Coordinador: backend, conciliación real aprobada y QA físico/visual/integración. Harvey: frontend de cierres y7 pruebas, sin cambiar métricas. Hilbert:12 pruebas y revisión independiente de conciliación/locks. Archivos compartidos bajo control del coordinador; sin ediciones simultáneas de server.js/App.jsx.

Superpowers ordenó contrato, riesgos y verificación; las guías PostgreSQL orientaron transacciones y locks acotados, y Frontend Design mantuvo la organización y componentes visuales existentes.

## Preparación de publicación sin pérdida de datos

Estos dos problemas están implementados y verificados en desarrollo/copia. No equivalen a aceptación global o despliegue productivo.

1. No restaurar esta copia sobre la base viva ni subir datos sintéticos: perdería lo cargado después del respaldo. Publicar mediante migraciones hacia adelante y conciliación explícita contra el estado vigente.
2. Obtener respaldo fresco y verificar identidad/schema/ledger/ACL actuales antes de la ventana. Revisar de nuevo el plan exacto y las diferencias publicadas de Wilson/WhatsApp; no reemplazar hostinger-deploy por esta rama sin integración revisada.
3. La herramienta de conciliación y el runner de desarrollo siguen bloqueando producción. Hace falta un mecanismo de ejecución productiva revisado y específicamente autorizado, no declarar production como sandbox ni borrar guards. El plan de este ensayo está vinculado a su identidad y snapshot: NO reutilizable en producción.
4. Conservar todas las tareas nuevas, cambios de fecha, usuarios y asignaciones que existan al momento de publicar. Si algún hash/membresía cambia, no sobrescribir: revisar y aprobar un plan nuevo. Mantener la decisión humana de Líder sin repartir, salvo instrucción posterior.
5. Verificar cuentas independientes de dueños/servicios/archivos externos y permisos reales. El cierre de estos dos puntos no crea cuentas ni verifica proveedores externos.
6. Desplegar artefacto frontend/backend coordinado solo tras ese control; comprobar build servido, login, tareas existentes, asignaciones, Reportes y límites financieros. Plan de rollback de código compatible con esquema aditivo; nunca restauración destructiva de DB como rollback ordinario.

Estado: **dos gates de compatibilidad resueltos y probados en copia; publicación pendiente de control y autorización operativa del destino, sin cambios en producción**.
