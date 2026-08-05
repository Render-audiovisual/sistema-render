# Wilson → RENDER OS

Este cliente reemplaza la creación de tareas en ClickUp. Wilson debe:

1. obtener cliente y responsable desde `catalog`;
2. completar cliente, responsable, fecha y sector sin inventarlos;
3. ejecutar `validate` y mostrar el borrador y los posibles duplicados;
4. esperar una confirmación individual de Franco o Agustín;
5. ejecutar `create` una sola vez con una clave de idempotencia estable;
6. responder con responsable, vencimiento y el enlace directo devuelto.

El alta siempre queda en estado `pendiente` y en
`propiedades_extra.workspace = "render_os"`. Si la API informa un posible
duplicado, Wilson no debe usar `--allow-duplicate` hasta recibir una nueva
confirmación explícita que identifique la tarea encontrada.

La credencial se lee desde `RENDER_OS_WILSON_TOKEN` o desde el archivo privado
`~/.openclaw/credentials/render_os.json`:

```json
{
  "api_token": "secreto",
  "base_url": "https://sistema.rendercorrientes.com/api/integraciones/wilson"
}
```

Ese archivo no pertenece al repositorio y debe tener permisos `0600`.
