# Contratos actuales de RENDER OS

Este documento caracteriza el comportamiento vigente que debe conservarse durante la refactorización interna. No define contratos nuevos.

## Entrada y aislamiento

- La ruta de interfaz es `/workspace/tareas`.
- El enlace directo a una tarea usa `/workspace/tareas?task=ID`.
- Las tareas del módulo se identifican con `propiedades_extra.workspace = "render_os"`.
- Las lecturas y mutaciones específicas agregan `workspace=render_os`.
- Las tareas históricas permanecen en el flujo `/piezas` y no deben aparecer ni poder modificarse desde RENDER OS.

## Endpoints utilizados

- Listado paginado: `GET /api/tareas?workspace=render_os&incluir_archivadas=true&limit=500&offset=OFFSET`.
- Consulta individual y enlaces directos: `GET /api/tareas/:id?workspace=render_os`.
- Creación: `POST /api/tareas`, con `workspace: "render_os"` en el cuerpo; el backend persiste el marcador dentro de `propiedades_extra`.
- Edición, cambio de estado, archivo y restauración: `PATCH /api/tareas/:id?workspace=render_os`.
- Eliminación definitiva: `DELETE /api/tareas/:id?workspace=render_os`.
- Lectura de comentarios: `GET /api/tareas/:id/comentarios?workspace=render_os`.
- Comentario manual y actividad automática: `POST /api/tareas/:id/comentarios?workspace=render_os`.
- Consulta de subtareas: `GET /api/tareas/:id/subtareas?workspace=render_os`.

## Detalle, dependencias y subtareas

- La URL mantiene sincronizado el parámetro `task` al abrir o cerrar un detalle.
- Si una dependencia no está en el lote cargado, se consulta por ID con el workspace de RENDER OS y se incorpora en memoria sin duplicarla.
- Las subtareas se consultan mediante el endpoint específico, sin descargar todas las páginas del tablero.
- Una tarea histórica o inexistente consultada mediante estos contratos se rechaza sin abrir un detalle válido.

## Comentarios y actividad

- Tanto la lectura como la escritura de comentarios incluyen `workspace=render_os`.
- Las entradas automáticas usan el mismo endpoint y anteponen `[Actividad]` al contenido.
- Una tarea histórica no acepta comentarios enviados mediante el contrato RENDER OS.

## Archivo, restauración y eliminación

- Archivar y restaurar son actualizaciones por `PATCH` dentro del workspace.
- La eliminación definitiva usa `DELETE` dentro del workspace.
- El backend valida el marcador antes de modificar o eliminar una tarea.

## Compatibilidad histórica

- `/piezas` conserva sus rutas, payloads y comportamiento anteriores.
- Los enlaces de notificaciones de RENDER OS usan `/workspace/tareas?task=ID`.
- Los enlaces de notificaciones históricas usan `/piezas?tarea=ID`.
- Esta refactorización no modifica autenticación, autorización, base de datos, SQL, rutas ni parámetros públicos.
