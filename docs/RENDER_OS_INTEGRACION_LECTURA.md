# RENDER OS — integración en modo lectura

## Objetivo de esta fase

Validar el nuevo sistema visual contra la API y la base actuales sin duplicar información ni habilitar cambios.

## Rutas nuevas

- `/workspace/tareas`
- `/workspace/clientes`
- `/workspace/equipo`

Las rutas anteriores continúan disponibles como respaldo:

- `/piezas`
- `/clientes`
- `/empleados`

## Fuentes de datos

La interfaz nueva consume exclusivamente peticiones `GET` autenticadas:

- `GET /api/tareas`
- `GET /api/clientes`
- `GET /api/usuarios`

No contiene llamadas `POST`, `PATCH`, `PUT` ni `DELETE`. La marca `Solo lectura` se muestra en las vistas y en el detalle de tarea.

## Mapeo actual

- Estado: `pendiente`, `en_progreso`, `en_revision`, `publicada`.
- Responsable: se compara temporalmente `tareas.asignado_a` con `usuarios.nombre` o `usuarios.usuario`.
- Cliente: `tareas.cliente_id` y `tareas.cliente_nombre`.
- Área: se deriva temporalmente de `tipo_tarea`, `subtipo` y título para representar los espacios aprobados.

El mapeo de responsables por nombre es transitorio. La fase operativa deberá migrar a `responsable_id` antes de permitir reasignaciones desde RENDER OS.

## Criterio de validación

Antes de habilitar escritura, comparar con la interfaz anterior:

1. Total de tareas.
2. Cantidad por estado.
3. Cantidad por cliente.
4. Responsable, fecha, prioridad, material e indicaciones en una muestra de tareas.
5. Total de clientes y usuarios.
6. Acceso correcto con rol administrador y rechazo de accesos sin JWT.

## Verificación realizada

- Build de frontend correcto.
- Nueve pruebas de backend aprobadas.
- Prueba navegable de Tareas, Clientes y Equipo en escritorio y móvil.
- Detalle de tarea marcado como solo lectura.
- Cero peticiones de escritura durante la prueba.
- Sin desbordamiento horizontal global en 390 px; las tablas extensas conservan scroll interno.

La comparación contra la base vigente debe hacerse en un staging conectado explícitamente al entorno actual. No se ejecutaron migraciones ni cambios sobre producción.
