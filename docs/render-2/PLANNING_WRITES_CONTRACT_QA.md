# Revisión 157: guardados de planificación con autoridad actual

## Contratos locales

`backend/src/planning-writes.js` integra los dos writers legacy sin modificar esquema ni datos históricos.

**POST /api/check-publicacion:** body cerrado con cliente_id numérico int32 positivo, fecha real exacta YYYY-MM-DD (años1–9999) y publicado boolean obligatorio. Rechaza strings booleanos, fechas normalizadas/imposibles, IDs string, campos desconocidos y confirmado_por proporcionado por caller. Conserva respuesta200 con los campos anteriores. Cliente inexistente devuelve404.

Al marcar, confirmado_por proviene del nombre actual de DB, con fallback al usuario/ID de la cuenta validada; confirmado_at usa reloj DB. Al desmarcar ambos quedan null. Se mantiene una fila por cliente/día mediante UPSERT. Este control es planificación diaria: NO confirma piezas ni crea evidencia real de publicación, tareas u objetivos.

**PATCH /api/fechas-especiales/:id:** ID decimal canónico int32 y body cerrado no vacío: estado opcional pendiente/en_curso/hecho e idea opcional string sin NUL. Omitir conserva; idea vacía borra explícitamente. Null explícito se rechaza. ID inexistente devuelve404; ACK200 conserva sus campos. No requiere fecha/cliente almacenados: el evento puede ser global y sin fecha. No permite cambiar fecha, cliente o evento mediante este PATCH.

El caller canónico del checklist (Historias.jsx) ya envía exactamente los tres campos tipados. No se encontró caller frontend del PATCH de fechas especiales. Otros consumidores que dependan de coerción o envíen campos adicionales deberán actualizarse antes de un despliegue: no se promete compatibilidad con inputs inválidos antiguos.

## Autoridad, transacción y límites

Ambos capturan identidad/epoch y una proyección inmutable de inputs antes del lease. Orden: BEGIN → mutex administrativo existente → actor actual FOR SHARE → recurso/DML → COMMIT. Inactividad/epoch obsoleto401; rol actual no admin403. El actor permanece retenido hasta commit; una revocación anterior impide escribir y una posterior espera. Checklist además retiene al cliente existente con FOR SHARE. No se introducen roles por nombre ni alias locales de dirección.

Rollback/release en errores; rollback fallido descarta conexión sin sustituir error principal. Las rutas incorporan no-store. Se conservan actualizaciones last-write-wins: no se añaden CAS ni receipts ni recuperación exacta de ACK perdido. Repetir una marca true puede renovar su timestamp; no equivale a un recibo inmutable.

Autorización usa ID/epoch reales y atribución deriva de DB. El campo persistido confirmado_por sigue siendo el TEXT heredado, no se añadió FK histórica de actor ni se reinterpretaron etiquetas antiguas. No se presenta como auditoría relacional inmutable completa.

## Coordinación y evidencia

- Integrador: helper, contratos, conexión de rutas en server.js y ejecución de pruebas. Único editor de server.js.
- Carver: planning-writes.test.js, 12 pruebas unitarias de normalización, captura, actor, parámetros, commit antes del ACK y errores de todas las etapas.
- Poincare: render2-planning-writes-authority.integration.test.js, fixture físico; integrador revisó y ejecutó.
- Beauvoir: revisión independiente favorable de tipos/calendario/atribución/locks y cleanup, sin edits ni ejecución.
- Hypatia: secuencia de aceptación intersectorial siguiente, sin modificar código ni ejecutar servicios. Plan separado, no validación ya lograda.

Pruebas ejecutadas:

1. `node --check src/planning-writes.js` y server.js; git diff --check satisfactorios.
2. `node --test test/planning-writes.test.js`:12/12 aprobadas. Matrices de formas/tipos/fechas/IDs/atribución, inputs congelados antes de await, fallos BEGIN/mutex/actor/recurso/DML/COMMIT y descarte por rollback fallido.
3. `RENDER2_RUN_LOCAL_INTEGRATION=true node --test test/render2-planning-writes-authority.integration.test.js`:13/13 aprobadas, sin omisiones. PostgreSQL nuevo propio55804, identidad de base/usuario/puerto/directorio verificada, HTTP real con cuentas sintéticas, hashes de tablas para ausencia de DML en errores/revocaciones. Ambos writers: tres revocaciones previas y PID exacto de revocador bloqueado hasta commit. Captura de auth/body prelease comprobada.
4. Checklist true/false, nombre falso rechazado, autor DB actual, timestamp/null y una fila estable. Evento global sin fecha y omisión vs texto vacío comprobados físicamente. Tablas de piezas, evidencia editorial, tareas, cuotas e historial ajeno no cambiaron por el checklist.
5. Cleanup ENOENT y ausencia posterior confirmados para `/private/tmp/render2-local-Y2UVHU`.
6. Regresión `render2-stories.integration.test.js`:6/6 aprobadas en otro cluster propio nuevo55691, cleanup comprobado por el test.
7. `npm test` backend final:2.035 casos,1.919 aprobados, cero fallos,116 omitidos por sus gates. No equivale a todas las integraciones físicas. Frontend sin cambios ni nueva certificación visual/móvil.

Logs temporales: `/private/tmp/render2-planning157-unit.log`, `/private/tmp/render2-planning157-physical.log`, `/private/tmp/render2-planning157-stories.log`, `/private/tmp/render2-planning157-final-backend.log`.

## Estado del rescate

S155-02 y S155-03 quedan corregidos/probados localmente dentro del alcance descrito. No se certifica la autorización de todas las rutas por cerrar estos hallazgos. Sin migraciones nuevas, dependencias, proveedores, bases configuradas o producción. No hubo despliegue.

Siguiente gate: un único recorrido físico producción de tres videos → edición/corrección/aprobación → cuota → confirmación manual efectiva → calendario/nueva sesión, sin duplicar tareas. Continúan pendientes calendario por encima de su cap, refresh de Inicio, foco del shell, orden manual nativo y QA visual global. El objetivo maestro sigue activo.
