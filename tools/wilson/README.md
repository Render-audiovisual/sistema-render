# Wilson → RENDER OS

Este cliente reemplaza la creación de tareas en ClickUp. Wilson debe:

1. obtener cliente y responsable desde `catalog`;
2. completar cliente, responsable, fecha y sector sin inventarlos;
3. ejecutar `validate` y mostrar el borrador y los posibles duplicados;
4. esperar una confirmación individual de Franco o Agustín;
5. ejecutar `create` una sola vez con una clave de idempotencia estable;
6. responder con responsable, vencimiento y el enlace directo devuelto.

Para una tarea existente, Wilson puede usar `get` para leerla y `update` para
editar título, descripción, cliente, responsable, fecha, sector, prioridad,
material o referencia. `--append-desc` agrega un bloque al brief sin borrar lo
anterior y evita repetir exactamente el mismo bloque. Toda edición requiere
confirmación de Franco o Agustín y una clave de idempotencia estable.

Ejemplo:

```bash
python3 tools/wilson/render_os_task.py get --task-id 1421 \
  --telegram-user-id 1826333320 --confirmed-by Franco

python3 tools/wilson/render_os_task.py update --task-id 1421 \
  --append-desc "VIDEO 2 — NUEVO BRIEF" \
  --telegram-user-id 1826333320 --confirmed-by Franco \
  --idempotency-key "<uuid>"
```

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
python3 scripts/mia_render_os_task.py propose --operation confirmar_grabacion \
  --task-id 1421 --payload '{}' --actor-id '<id>' --actor-name 'Franco' --group-id '<grupo>'

python3 scripts/mia_render_os_task.py confirm-production --task-id 1421 \
  --confirmation-token '<token>' --actor-id '<id>' --actor-name 'Franco' --group-id '<grupo>'
```

El backend valida que la visita esté completa y tenga Drive, registra quién
confirmó y crea una sola tarea de edición vinculada para Luciano.

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
