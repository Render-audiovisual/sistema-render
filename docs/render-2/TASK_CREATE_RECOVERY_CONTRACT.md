# Alta de tareas: recuperación e idempotencia

## Estado y alcance

Hallazgo306 reproducido en desarrollo local; **implementación API+UI en307–309, pendiente aceptación nativa de ACK perdido**. Corte307 incorpora base interna opt-in en task-persistence, módulo task-create-receipts y migración090 con pruebas de concurrencia/rollback/replay. Corte308 conecta POST con UUID al contrato por IDs y añade GET autenticado `/tareas/creaciones/:requestId`; legacy conserva DTO plano. Corte309 conecta formulario, incertidumbre/GET/reintento exacto y admisión única por ID, con pruebas de modelo/callbacks y regresión; no acredita aún navegador montado. Prioridad transversal para recorridos maestros Tareas y Audiovisual. No afecta la separación trabajo/publicación ya implementada, ni demuestra acceso no autorizado. No autoriza despliegue.

Coordinador inspeccionó el flujo actual y ejecutó el diagnóstico; Harvey identificó la brecha y revisó el contrato sin escribir código ni ejecutar servicios. Superpowers orientó priorizar un fallo operativo reproducible sobre seguir renovando pruebas visuales de módulos ya comprobados.

## Evidencia actual

- `frontend/src/pages/WorkspaceReadOnly.jsx`, NewTaskModal.submit: conserva draft y permite otro envío tras catch; createTask hace POST `/api/tareas` sin identidad de intento. El cierre afirma que no se creó, aun cuando el resultado puede ser desconocido.
- `backend/src/server.js`, POST `/tareas`: request_id no participa en la creación. Resuelve asignaciones antes de llamar persistAssignedTask.
- `backend/src/task-persistence.js`: transacción única de tarea/asignaciones/visita y actor retenido; cada nueva llamada inserta otra fila. No hay recibo de esta creación canónica. Los recibos de comandos MIA no son su contrato.

Script `/private/tmp/render2-goal306-create-repro.mjs`, opt-in `RENDER2_RUN_LOCAL_INTEGRATION=true`, harness generado PG55924, API principal real. Cuenta sintética dueña91001, tareas autoasignadas sin destinatarios externos. Después de recibir201 y verificar la fila, el diagnóstico no admite ese resultado al caller simulado y vuelve a enviar el mismo JSON con el mismo UUID. No reproduce un corte de red físico ni un modal React montado.

Resultado confirmado:

| Caso | Primer ID | Reintento | Efecto adicional |
| --- | --- | --- | --- |
| Tarea normal | 1 | 2 | Asignación nueva para cada tarea |
| Subtarea del mismo padre1 | 3 | 4 | Ambas conservan padre1 |
| Visita del mismo cliente/fecha | 5 | 6 | Dos visitas con orígenes distintos |

Seis tareas, seis asignaciones, dos visitas. Otras101 tablas de dominio conservan hash. Log `/private/tmp/render2-goal306-create-repro.log`: `REPRODUCED_TASK_CREATE_DUPLICATION_AFTER_HIDDEN_201`, salida0 significa **defecto reproducido**, no funcionalidad aceptada. Cleanup ENOENT `/private/tmp/render2-local-QCNjas`.

Primera ejecución falló en la aserción de invariantes por nombrar `produccion_participantes` en lugar de `produccion_visita_participantes` dentro de la allowlist del fixture; producto no cambió. Finally limpió GVJu39 y la repetición corregida pasó. Log inicial separado `/private/tmp/render2-goal306-create-repro-initial.log`. No se tocaron bases configuradas, proveedores, frontend build ni producción.

## Contrato de integración que debe conservarse

1. Una identidad de intento UUID por alta humana. Reintentar un resultado incierto conserva exactamente ese UUID y payload. Una creación distinta debe ser una decisión explícita, no efecto de un catch.
2. Recibo duradero independiente de MIA, clave actor_user_id+request_id, hash del contrato normalizado, task_id, evidencia de versión y fecha. No almacenar DTO privado completo ni credenciales. Recibo inmutable, sin FK que lo elimine junto a la tarea; no resucitar recursos borrados.
3. Canonicalizar todos los campos aceptados y defaults del alta: título/textos según semántica guardada, workspace, IDs de responsable/colaboradores, cliente, padre, vínculos editoriales, estado permitido, prioridad, fecha, aprobación solicitada, tipo/subtipo, resumen, etiquetas, material y videos previstos. No derivar el hash de nombres actuales ni timestamps generados. El contrato nuevo prefiere IDs explícitos; mantener compatibilidad legacy por separado hasta migrar consumidores.
4. Capturar actor/entrada antes de cualquier await. Una sola conexión y transacción existente, sin doble BEGIN: actor vigente retenido → mutex actor+UUID → lookup del recibo → dominio. Comparación de hash conflictiva409 antes de nuevas mutaciones.
5. Replay antes de resolver otra vez las asignaciones activas: una baja/rename del responsable posterior al alta no debe convertir recuperación en otra creación. Revalidar acceso actual a la tarea al devolverla. Sesión inválida401, ausente/inaccesible404 genérico; nunca otra inserción. No devolver un snapshot privado histórico automáticamente.
6. Solo intento nuevo resuelve/bloquea miembros y ejecuta tarea→asignaciones→syncProductionVisitFromTask→recibo→COMMIT. Rollback no deja filas parciales. Replay no ejecuta afterSave, no reemplaza asignaciones, no repite avisos ni actividad cliente.
7. Respuesta perdida o COMMIT incierto no acredita ausencia/rollback. UI congela el intento, conserva borrador y permite verificar/reintentar exactamente el mismo. Leer inventario por título no confirma un intento. Sesión o selección obsoleta no puede pintar ni despachar con otro actor.
8. Integración principal a cargo del coordinador en server.js y task-persistence.js. QA independiente puede editar tests dedicados, no esos archivos compartidos. Migración aditiva solo sobre PG desechable hasta autorización del destino.

No se promete outbox/exactly-once de proveedores: un crash entre COMMIT y notifier puede perder aviso. Evitar duplicarlo por replay no resuelve esa limitación. No reutilizar receipts Wilson ni deduplicar altas distintas por título.

## Gates antes de aceptar la corrección

- Dos peticiones concurrentes del mismo actor/UUID/payload: una tarea/recibo/asignación/visita; ambos resultados identifican la misma tarea.
- Mismo UUID con payload distinto409; dos UUID distintos siguen permitiendo dos altas deliberadas.
- Actor distinto no puede recuperar recibo ajeno; revocación anterior rechaza, revocación posterior respeta el orden transaccional existente.
- Fallo entre inserción y relación/visita/recibo: rollback íntegro. Error o ACK perdido después de COMMIT: recuperación devuelve mismo ID sin más efectos.
- Tarea normal, subtarea y visita; relaciones con cliente/padre/vínculos intactas. Borrado o pérdida de acceso después del alta: no recrear ni filtrar datos.
- Baja/rename del responsable después del alta: replay no depende de resolver nuevamente el nombre o actividad de ese destinatario.
- UI montada: doble envío, borrador posterior, sesión ABA, desmontaje, recuperación sin segundo alta y cierre con texto honesto; escritorio/móvil y recarga del registro compartido.
- Mantener pruebas de autoridad, DTO, notificaciones por ID y trabajo distinto de publicación. Migración repetible, sin reinterpretar tareas históricas.

Backend HTTP opt-in implementado/verificado por308 y formulario conectado por309 (ver CURRENT_ACCEPTANCE).311 acredita navegador→201 suprimido tras COMMIT→GET de verificación→misma tarea/visita→recarga, con fecha elegida desde calendario nativo y SQL exacto.310 parcial aisló una interacción date.fill no adoptada; no se cambió producto para simular éxito. Reintento POST nativo y demás intercalados/roles siguen pendientes; este cierre estable no equivale a aceptación global ni despliegue.
