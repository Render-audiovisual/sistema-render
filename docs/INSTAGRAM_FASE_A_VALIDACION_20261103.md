# Integración del parche de estadísticas — 2026-11-03

Base: `4bf2c862`, rama `codex/render-2-release-20261029`.

- Parche: `instagram-estadisticas.txt`, tres commits de formato mbox.
- Sábados: ya integrado mediante `c09f4501`; se conserva la implementación revisada, sin reaplicar el binario Python incluido en el parche antiguo.
- Tarjeta de carrusel: ya integrada mediante `fd44390a`.
- Fase A: aplicada con `git am -3`. El conflicto en App.jsx se resolvió conservando `loadInstagramReportModule`, sin revertir la optimización de carga.
- Se actualizó el test de tarjetas para validar los dos enlaces independientes y la ausencia del acceso a estadísticas cuando no hay cuenta vinculada.

## Verificación previa al push

- Backend completo: 3.848 tests, 3.622 aprobados, 13 fallidos, 213 omitidos. La base sin parche tiene los mismos 13 fallos (3.841 tests, 3.616 aprobados, 212 omitidos).
- Frontend completo: la base tiene 58 fallos preexistentes. Se repite la suite tras adaptar la expectativa del enlace nuevo; no se alteran módulos ajenos para ocultar esos fallos.
- Tests específicos: backend 12/12, frontend 30/30, tarjetas 6/6.
- Integración PostgreSQL temporal de estadísticas y regresión de equipo: 11/11, sin omisiones.
- Build Vite: satisfactorio.

Los fallos generales preexistentes impiden afirmar que toda la suite está verde. Los tests omitidos no se presentan como aprobados. Las pruebas de integración habilitadas usan exclusivamente un clúster local desechable.

No se ejecutaron migraciones ni conexiones de escritura sobre producción. No se reemplazaron bases, tareas, asignaciones, publicaciones ni automatizaciones.
