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
