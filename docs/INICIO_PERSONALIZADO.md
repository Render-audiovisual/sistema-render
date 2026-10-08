# Inicio personalizado de Render

Todo el equipo ingresa a `/inicio`. El tablero existente sigue en `/workspace/tareas`.

## Qué muestra

El diseño del Inicio reutiliza los tokens de `frontend/src/design-system.css`: fondo, tipografía Poppins, acento lima, separadores, radios y controles del resto del sistema. Una cuadrícula de paneles reemplaza la lista larga: indicadores, distribución por estado, agenda de siete días, tres tarjetas prioritarias, feedback y carga de trabajo.

Los estados incluyen finalizadas registradas, no un porcentaje de cumplimiento mensual. La agenda cuenta abiertas con vencimiento desde hoy hasta hoy + 6. La carga agrupa por responsable principal (equipo) o cliente (vista personal), sin duplicar colaboradores. Archivadas y papelera se excluyen. Seleccionar estado, día o grupo filtra las tres tarjetas. Animaciones breves respetan `prefers-reduced-motion`.

- Tareas propias por nombre/usuario y colaboradores, conservando permisos existentes.
- Orden: vencidas, hoy, próximos siete días, en proceso y futuras/sin fecha.
- Las tareas en revisión se muestran como espera, no como producción que debe repetir el autor.
- Administradores ingresan en Rendimiento del equipo y pueden alternar a Mis reels. La vista del equipo muestra carga abierta, vencidas y revisiones de todos los responsables con tareas abiertas. Mis reels filtra edición y piezas explícitamente clasificadas como reel/video, asignadas o compartidas con el usuario conectado.
- Las barras comparan la cantidad de tareas abiertas dentro de la vista; el tramo rojo marca vencidas. No representan una cuota mensual de publicaciones. La fila inferior de atajos fue retirada.
- Feedback asignado pendiente e indicaciones permanentes separados. El origen devuelve las 500 notas más recientes.
- Cada elemento abre la tarea o nota existente; Inicio no cambia responsables, estados, notas ni cuotas.
- Día operativo calculado en America/Argentina/Cordoba.

## Conservación del historial

La limpieza automática de tareas queda desactivada por defecto, incluyendo papelera. Solo se ejecuta si `TASK_AUTOMATIC_DELETION_ENABLED=true`. La eliminación de completadas requiere además `TASK_COMPLETED_CLEANUP_ENABLED=true`. No activar estas opciones si se debe conservar todo el historial.

La reconciliación del calendario no elimina publicaciones que tengan tareas vinculadas, para evitar borrados por cascada. No se agregan migraciones ni se modifican datos existentes en esta implementación.

## Validación y despliegue

Compilar con `npm run build --prefix frontend` y ejecutar `npm test --prefix backend` y `node --test frontend/src/features/render-os/utils/home-dashboard.test.js`.

Basado en `hostinger-deploy` commit `433c2f33`, confirmado como versión activa en Hostinger. Guardar la versión anterior en Git antes de desplegar; usar el mismo sitio y configuración. No ejecutar semillas, importaciones o migraciones nuevas.

Después del despliegue: comprobar Inicio, alternancia de equipo, enlaces a tareas/feedback y que el tablero conserve su cantidad de registros. Para revertir únicamente la interfaz se pueden restaurar QuickHome, Sidebar y route-utils; conservar las protecciones del historial.

Los agentes de implementación, diseño y revisión usados durante el trabajo no son dots persistentes. No se configuró monitorización recurrente.
