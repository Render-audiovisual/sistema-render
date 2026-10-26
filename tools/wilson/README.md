# Wilson → RENDER OS

Compatibilidad local bajo contrato; no certifica despliegue, transporte real
ni entrega de notificaciones en producción.

Este cliente reemplaza la creación de tareas en ClickUp. Wilson debe:

1. obtener cliente y responsable desde `catalog`;
2. completar cliente, responsable, fecha y sector sin inventarlos;
3. ejecutar `validate` y mostrar el borrador y los posibles duplicados;
4. solicitar token exacto con `propose` y esperar confirmación humana de una identidad mapeada autorizada;
5. ejecutar `create` con ese token y la misma clave de idempotencia estable;
6. responder con responsable, vencimiento y el enlace directo devuelto.

Para una tarea existente, Wilson puede usar `get` para leerla y `update` para
editar título, descripción, cliente, responsable, fecha, sector, prioridad,
material o referencia. `--append-desc` agrega un bloque al brief sin borrar lo
anterior y evita repetir exactamente el mismo bloque. Toda edición requiere
token exacto, clave de idempotencia estable y la revisión observada en GET.
Los nombres y `--confirmed-by` son etiquetas legacy, nunca permisos. El backend
resuelve el usuario interno actual y controla membresía, rol y transporte.

Ejemplo:

```bash
python3 tools/wilson/render_os_task.py get --task-id 1421 \
  --telegram-user-id '<actor-mapeado>'

python3 tools/wilson/render_os_task.py propose --operation editar --task-id 1421 \
  --payload '{"append_descripcion":"VIDEO 2 — NUEVO BRIEF","expected_revision":7}' \
  --telegram-user-id '<actor-mapeado>' --idempotency-key '<uuid-estable>'

python3 tools/wilson/render_os_task.py update --task-id 1421 \
  --append-desc "VIDEO 2 — NUEVO BRIEF" \
  --telegram-user-id '<actor-mapeado>' --expected-revision 7 \
  --confirmation-token '<token-exacto>' --idempotency-key '<uuid-estable>'
```

La revisión 7 es ilustrativa: usar exactamente la que vio el usuario, sin
consultar otra para rebasar silenciosamente la intención. Para eliminar,
un admin puede obtener la revisión archivada mediante `get --include-archived`.
Los comandos `archive` y `delete` también requieren token, key y revisión;
esta última puede ir en `--payload '{"expected_revision":7}'` o
`--expected-revision 7`. Sus propuestas usan `archivar` y `eliminar`.

En WhatsApp usar el cliente canónico `backend/scripts/mia_render_os_task.py`,
o el wrapper compatible `scripts/mia_render_os_task.py`. Los flags de identidad
van **antes** del subcomando. Ejemplo de intención idéntica:

```bash
python3 scripts/mia_render_os_task.py --actor-id '<actor>' --actor-name '<etiqueta>' \
  propose --operation editar --task-id 1421 --idempotency-key '<uuid-estable>' \
  --payload '{"append_descripcion":"Nuevo brief","expected_revision":7}'

python3 scripts/mia_render_os_task.py --actor-id '<actor>' --actor-name '<etiqueta>' \
  update --task-id 1421 --idempotency-key '<uuid-estable>' \
  --confirmation-token '<token-exacto>' \
  --payload '{"append_descripcion":"Nuevo brief","expected_revision":7}'
```

Para las cuatro operaciones, propuesta y mutación envían la misma key en el
cuerpo y header. El helper Python `task_operation_payload` valida sin HTTP;
editar/archivar/eliminar exigen entero positivo observado, sin timestamp
alternativo ni revisión generada. Crear no necesita revisión. Las claves
vacías, controles, más de 200 caracteres o desacuerdos se rechazan localmente.
Omisión, `null`, cadenas vacías y listas vacías de negocio no se reinterpretan
en el CLI; el backend valida cuáles son válidas. Un no-op confirmado también
puede tener recibo sin aumentar la revisión.

Telegram permite elegir cliente con `--client-id` y dueño/colaboradores con
`--assignee-id` / `--collaborator-id` repetible. Los nombres siguen como
selectores de negocio solo si el servidor los resuelve sin ambigüedad. Para
editar con omisiones, vaciados o eliminación de todos los colaboradores,
también acepta `update --payload '<json-exacto>'` (sin mezclar flags de negocio),
incluyendo `colaborador_ids: []` y `expected_revision` observada. Para
proponer una creación, usar el mismo JSON que construyen los flags de create:
titulo, descripcion, cliente o cliente_id, responsables o asignado_a_id y
colaborador_ids, fecha_vencimiento, sector, prioridad, material, referencia y
permitir_duplicado. No pasar `confirmado:true`: ya no sustituye al token.

El recibo nuevo describe un resultado mínimo; un retry puede devolver el DTO
actual, una tarea archivada sin contenido o un tombstone. No asumir que siempre
existe `task` ni presentar el DTO actual como snapshot original. No reintentar
con otra key o revisión para evadir un 409. Tras cambios de intención,
selección o expiración, volver a mostrarla y renovar la confirmación. Ver
[contrato de recibos](../../docs/render-2/TASK_RECEIPTS_CONTRACT.md).

El alta siempre queda en estado `pendiente` y en
`propiedades_extra.workspace = "render_os"`. Si la API informa un posible
duplicado, Wilson no debe usar `--allow-duplicate` hasta recibir una nueva
confirmación explícita que identifique la tarea encontrada.

Cada solicitud se firma con la clave privada
`~/.openclaw/credentials/render_os_private.pem`. La clave nunca sale del VPS;
Hostinger conserva solo la clave pública. El archivo privado no pertenece al
repositorio y debe tener permisos `0600`.

## Confirmación de una visita de producción desde WhatsApp

Cuando una visita alcanza la cantidad prevista, Mía debe mostrar el resumen y
esperar que Franco o Agustín confirmen. La confirmación dura quince minutos y se
ejecuta con el cliente firmado `scripts/mia_render_os_task.py`:

```bash
python3 scripts/mia_render_os_task.py --actor-id '<id>' --actor-name '<etiqueta>' --group-id '<grupo>' \
  propose --operation confirmar_grabacion --task-id 1421 --payload '{"expected_revision":7}'

python3 scripts/mia_render_os_task.py --actor-id '<id>' --actor-name '<etiqueta>' --group-id '<grupo>' \
  confirm-production --task-id 1421 --expected-revision 7 --confirmation-token '<token>'
```

Este flujo de producción es independiente de los cuatro recibos de tareas;
no se cambió su política aquí. El backend valida visita/Drive y los vínculos
vigentes; nunca deducir autoridad o destinatario de un nombre de ejemplo.

## Informar tareas terminadas desde un grupo

Cuando una persona diga que terminó una o varias tareas, Mía no debe moverlas
directamente ni adivinar entre coincidencias. El flujo obligatorio es:

1. extraer una referencia separada para cada tarea mencionada;
2. ejecutar `resolve-review` con esas referencias;
3. si alguna respuesta es `ambiguous` o `not_found`, mostrar las opciones y no
   crear una confirmación;
4. ejecutar `preview-review` solo con un listado completamente resuelto;
5. enviar sin modificar el texto numerado devuelto y preguntar `¿Confirmás?`;
6. ejecutar `confirm-review` únicamente ante una confirmación afirmativa dentro
   de los quince minutos.

```bash
python3 scripts/mia_render_os_task.py resolve-review \
  --references '["Luzin Carrusel 1 2026-09-03", "Bendita Carrusel 2"]' \
  --actor-id '<id>' --actor-name 'Mariano Meza' --group-id '<grupo>'

python3 scripts/mia_render_os_task.py preview-review \
  --task-ids '[1501, 1508]' \
  --actor-id '<id>' --actor-name 'Mariano Meza' --group-id '<grupo>'

python3 scripts/mia_render_os_task.py confirm-review \
  --confirmation-token '<token>' \
  --actor-id '<id>' --actor-name 'Mariano Meza' --group-id '<grupo>'
```

La persona que informó, Franco o Agustín pueden confirmar. Si el usuario corrige
la lista, Mía debe volver a resolver y previsualizar: el resumen anterior queda
invalidado. Si una tarea cambia, se elimina o deja de estar disponible antes de
confirmar, el backend cancela el lote completo; nunca aplica una parte. Las
visitas conservan sus controles de videos, Drive y confirmación de producción.
Mía solo puede llevar estas tareas hasta `en_revision`; no finaliza, elimina ni
reasigna mediante este flujo.

## Finalización privada y edición por video (Render 2)

Estos contratos se preparan y verifican localmente antes de publicar. No son
aliases de `confirm-review`: enviar a revisión no aprueba ni finaliza trabajo.
La identidad y el rol se verifican en el servidor; “Franco” o “Agustín” como
etiqueta de transporte no conceden permisos.

Para finalizar, en **chat privado**, ejecutar `resolve-finalization --references
'["referencia de la tarea"]'`, resolver ambigüedades y luego
`preview-finalization --task-ids '[1501]'`. Mostrar el resumen exacto devuelto y
esperar una nueva confirmación humana. Solo entonces ejecutar
`confirm-finalization --confirmation-token '<token>'`. Los flags de identidad
van antes del subcomando. No reutilizar tokens de revisión o del contrato antiguo.

El cierre requiere el permiso actual y trabajo aprobado. Las visitas conservan
sus controles de evidencia; no se confirman ni crean edición al cerrarlas. Un
empleado de Edición puede enviar a revisión, pero no obtiene permiso para cerrar
trabajo no aprobado. Finalizar **nunca** publica una pieza ni carga una fecha de
publicación real. Un rechazo no debe responderse como si hubiera finalizado.

Para edición parcial, consultar `production-videos --visit-id '<uuid-visita>'`.
Elegir explícitamente un `video_id` grabado, `editor_id` y `fecha_entrega`:

```json
{"visita_id":"<uuid-visita>","video_id":"<uuid-video>","expected_revision":7,"editor_id":21,"fecha_entrega":"2026-11-03","notificar_asignacion":false}
```

Los valores son ilustrativos: usar únicamente IDs y revisión observados.
Enviar ese JSON a `preview-video-editing --payload '<json>'`, mostrar cliente,
video, material, editor, entrega y decisión de aviso, y esperar confirmación.
Después ejecutar `confirm-video-editing --payload '<mismo-json>'
--confirmation-token '<token>'`. No cambiar datos ni notificación entre pasos.
No inferir la entrega de la fecha de visita. Cada video tiene su propia tarea.

Un conteo histórico de videos o `tarea_origen_id`/`tarea_padre_id` solos no
identifican material individual: requieren conciliación explícita en Producciones.
No inventar videos, repartir guiones automáticamente ni crear una edición
agregada paralela. Un 409 exige nueva observación y confirmación, no reintentos
con revisiones o tokens reemplazados silenciosamente.

## Consultas rápidas de trabajo

Para responder `¿qué hago ahora?`, `¿qué tengo vencido?` o `¿cómo viene
Germán?`, Mía debe usar `fast-context` antes que descargar la lista general de
tareas. La respuesta ya viene priorizada, incluye las métricas del rol y limita
el detalle a seis tareas; esto reduce contexto y acelera la conversación.

```bash
python3 scripts/mia_render_os_task.py fast-context \
  --actor-id '<id>' --actor-name 'Augusto'

python3 scripts/mia_render_os_task.py fast-context --person 'Germán' \
  --actor-id '<id-lider>' --actor-name 'Franco'
```

Cada empleado puede consultar únicamente su propio contexto. Franco y Agustín
también pueden consultar a otra persona. Esta operación es de solo lectura: no
modifica tareas, responsables, estados ni registros.

## Feedback y tareas desde WhatsApp

Cuando un mensaje contiene una preferencia, corrección o reclamo, Mía debe
recomendar `Feedback`. Cuando pide una acción concreta con fecha o entrega,
debe recomendar `Tarea`. Si contiene ambas cosas, debe preparar ambos borradores
sin guardar todavía.

Mía pregunta únicamente los datos faltantes y presenta un solo resumen corto:
cliente o `Equipo`, título, detalle, vigencia, estado y responsables para el
feedback; cliente, sector, prioridad, fecha, descripción y responsables para la
tarea. Puede analizar texto transcripto de audios o imágenes, pero RENDER OS
guarda solamente texto. Siempre termina con `Confirmar`, `Modificar` o
`Cancelar`; la confirmación vence a los quince minutos.

Antes de confirmar un feedback se debe ejecutar `validate-feedback`. Si aparecen
duplicados, Mía ofrece modificar el anterior o crear uno nuevo; nunca decide por
su cuenta. El alta confirmada usa `crear_feedback` y una idempotency key estable:

```bash
python3 scripts/mia_render_os_task.py --actor-id '<id>' --actor-name '<etiqueta>' \
  validate-feedback --payload '<json>'

python3 scripts/mia_render_os_task.py --actor-id '<id>' --actor-name '<etiqueta>' \
  propose --operation crear_feedback --idempotency-key '<uuid>' --payload '<mismo-json>'

python3 scripts/mia_render_os_task.py --actor-id '<id>' --actor-name '<etiqueta>' \
  create-feedback --payload '<mismo-json>' --confirmation-token '<token>' --idempotency-key '<uuid>'
```

Los responsables son equivalentes: no se comunica un responsable principal.
Se exige al menos uno y, al guardar, cada responsable recibe un aviso privado
por WhatsApp. Para una solicitud mixta, Mía valida feedback y tarea, muestra un
solo resumen al usuario y, después del mismo “sí”, ejecuta las dos altas con sus
confirmaciones técnicas correspondientes.

## Lista privada y recordatorios personales

Mía distingue siempre entre `Tarea` (visible para el equipo) y `Lista` (privada
del usuario). Si el pedido no aclara el destino, pregunta: “¿Querés guardarlo
como tarea del equipo, en tu lista privada o en ambas?”. Las dos copias son
independientes; terminar una tarea pública nunca tacha automáticamente la Lista.

La Lista se opera únicamente en chat privado. Si el pedido comienza en un grupo,
Mía responde que continuará por privado y no muestra allí el contenido, las
opciones ni la confirmación. Antes de crear, editar, tachar, reabrir, eliminar o
programar un recordatorio debe ejecutar `propose-list`, mostrar exactamente el
resumen y esperar `confirmo`. Esta confirmación no vence, pero una propuesta
nueva reemplaza la anterior. Si hay más de una coincidencia, muestra el listado
numerado devuelto por la API y nunca adivina.

```bash
python3 scripts/mia_render_os_task.py personal-list \
  --actor-id '<whatsapp>' --actor-name 'Augusto'

python3 scripts/mia_render_os_task.py propose-list --operation crear \
  --payload '{"texto":"Terminar carrusel de Búnker","recordar_en":"2026-10-03T08:00:00-03:00","repeticion":"una_vez"}' \
  --actor-id '<whatsapp>' --actor-name 'Augusto'

python3 scripts/mia_render_os_task.py confirm-list --confirmation-token '<token>' \
  --actor-id '<whatsapp>' --actor-name 'Augusto'
```

Si falta la hora, Mía pregunta “¿A qué hora querés que te lo recuerde?”. Admite
una vez, diario, días hábiles, semanal o cada N días. “Listo”, “pasalo para
mañana” y frases similares se resuelven primero contra `personal-list`; ante
varias coincidencias se pide elegir. Agustín y Franco pueden indicar `--user-id`
para asistir técnicamente a otra persona; el uso normal siempre apunta al dueño
del WhatsApp. Un número sin vincular no modifica datos y genera un aviso privado
deduplicado para ambos líderes.
