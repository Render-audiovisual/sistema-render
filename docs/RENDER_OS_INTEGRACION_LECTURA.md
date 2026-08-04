# RENDER OS — integración operativa en Tareas

## Alcance

RENDER OS está integrado dentro del sistema vigente en `/workspace/tareas`.
No es una aplicación ni un despliegue separado. Las rutas históricas, incluida
`/piezas`, permanecen disponibles para rollback y para consultar las tareas
anteriores.

`/workspace/clientes` y `/workspace/equipo` no forman parte de esta integración.
Clientes y Usuarios continúan en sus rutas y con sus permisos existentes.

## Operaciones disponibles

La interfaz permite crear y editar tareas, cambiar estados, archivar, restaurar,
eliminar, gestionar subtareas y dependencias, asignar responsables y
colaboradores, usar etiquetas, comentar y consultar la actividad. Incluye vistas
de tablero, lista, calendario y por cliente, además de filtros y paginación.

## Aislamiento de tareas

Las tareas nuevas creadas desde RENDER OS se guardan con:

```json
{
  "workspace": "render_os"
}
```

dentro de `propiedades_extra`.

La colección se consulta con `GET /api/tareas?workspace=render_os`. La interfaz
histórica consulta sin ese parámetro y excluye las tareas de RENDER OS. De este
modo, un tablero sin filas marcadas como `render_os` aparece vacío aunque la base
contenga tareas históricas.

Las operaciones por ID realizadas por la interfaz nueva incluyen
`?workspace=render_os`. En ese modo, consulta individual, edición, cambio de
estado, archivo, restauración, eliminación y comentarios exigen el mismo
marcador JSONB. Un ID histórico o inexistente responde `404` y no se modifica.
Las subtareas también validan que la tarea padre pertenezca a RENDER OS.

El enlace directo `/workspace/tareas?task=ID` obtiene esa tarea mediante
`GET /api/tareas/:id?workspace=render_os`, por lo que funciona aunque el elemento
no esté en la primera página y no permite abrir tareas históricas.

## Concurrencia

Las ediciones envían `expected_updated_at`. Si otra operación actualizó la fila
desde que fue cargada, el backend responde `409` y conserva la versión vigente.

## Validación con PostgreSQL QA

Las pruebas unitarias que no requieren base se ejecutan normalmente. La suite
HTTP de workspace solo se activa cuando existen ambas variables:

- `DATABASE_URL`: conexión a una base PostgreSQL aislada y migrada.
- `RENDER_OS_TEST_DATABASE=true`: confirmación explícita de que es una base QA
  descartable.

La base debe estar vacía de tareas `render_os` al comenzar. La suite crea datos
sintéticos, llama a los endpoints HTTP reales y limpia sus filas al finalizar.
Nunca debe apuntarse a producción.

## Estado de entrega

La integración se mantiene en `render-os-integration`. Esta preparación no
incluye merge a `hostinger-deploy`, despliegue, seeds, migraciones sobre entornos
remotos ni cambios sobre datos productivos.

La ausencia de autorización JWT/roles en el backend es una condición global
preexistente del sistema y queda fuera de esta integración. Debe abordarse por
separado sin mezclarla con el aislamiento de workspace.
