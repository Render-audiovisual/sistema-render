# Métricas de Instagram — Fase 1 (datos)

Lee reels, carruseles e imágenes del feed de cada cliente desde la Graph API de Meta
y guarda métricas históricas. Solo lectura hacia Meta. No toca publicaciones, tareas
ni objetivos: escribe únicamente en las tablas `instagram_*` (migración 094).

## Piezas

| Archivo | Rol |
|---|---|
| `backend/migrations/094_instagram_metricas.sql` | Tablas `instagram_cuentas`, `instagram_cuenta_seguidores`, `instagram_media`, `instagram_media_metricas` (append-only). |
| `backend/src/instagram-graph.js` | Cliente HTTP mínimo. Token en encabezado `Authorization`, nunca en URL ni logs. Solo sigue paginación a `graph.facebook.com`. |
| `backend/src/instagram-sync.js` | Job `instagram` del ejecutor programado. |
| `backend/src/instagram-accounts.js` | Vincular cuenta ↔ cliente (lo expone la Fase 2, solo Líder). |

## Cómo funciona cada corrida

1. Descubre las cuentas profesionales de IG de las páginas asignadas al usuario del sistema.
   Guarda seguidores del día. Una cuenta que deja de aparecer queda `activa=false`
   (una respuesta vacía de Meta no desactiva nada).
2. Solo sincroniza cuentas **vinculadas explícitamente** a un cliente activo.
3. Trae publicaciones de los últimos 35 días (90 la primera vez).
4. Mide cada pieza según su antigüedad: <2 días cada hora, <7 días cada 6 h,
   <35 días cada 24 h. Después queda la última medición.
5. Vincula cada post con la pieza del sistema: mismo cliente (o grupo de feed),
   misma fecha de Córdoba y tipo (`reel`↔`reel/video`, `carrusel`↔`carrusel`,
   `imagen`↔`flyer`). Un único candidato → `automatico`; varios → `ambiguo`;
   ninguno → `sin_pieza`. `manual` nunca se reescribe.
6. Audita en `integracion_auditoria` (`integracion='instagram_graph'`) un resumen por
   corrida y los errores por cuenta, sin contenido ni token.

Errores: token inválido o límite de Meta cortan la corrida (sin checkpoint, se
reintenta en la próxima hora). Un error de permisos en una cuenta no frena las demás.

## Configuración (Fase 0)

1. App tipo Business en developers.facebook.com, vinculada al Business Manager de Render.
2. Usuario del sistema (Administrador) con la app y las páginas/cuentas IG de los clientes asignadas.
3. Token sin vencimiento con `instagram_basic`, `instagram_manage_insights`,
   `pages_show_list`, `pages_read_engagement`, `business_management`.

Variables del ejecutor (no del servidor web):

```
META_SYSTEM_USER_TOKEN=...        # secreto, solo en el entorno privado
META_GRAPH_VERSION=v23.0          # opcional
META_BUSINESS_ID=1034453457860259 # portfolio de Render, fallback de descubrimiento
RENDER_AUTOMATION_JOBS=editorial,wilson,supervisor,instagram
```

## Puertas antes de activar en producción

- Las migraciones 094/095 quedan fuera del tren cerrado de release 2026-10-29.
  La vía separada `backend/src/instagram-migration.js` admite únicamente esas
  dos migraciones con los hashes de SQL revisados, en una sola transacción.
  El publicador histórico sigue rechazando su inclusión con `SQL_CHANGED`.
- Este parche no activa ni cambia la configuración de los trabajos en Hostinger.
  Verificar el estado vigente antes de habilitar los trabajos nuevos; no asumir
  que la configuración histórica de `ops/scheduled-automations-release.txt` sigue vigente.

## Pruebas

```
node --test test/instagram-graph.test.js test/instagram-sync.test.js
RENDER2_RUN_LOCAL_INTEGRATION=true node --test test/instagram-sync.integration.test.js
```

La prueba de integración crea una base local desechable, verifica su identidad,
aplica allí las migraciones y la retira al finalizar. No acepta una URL de base
externa ni utiliza la base configurada en el sistema.

Los tests históricos de `production-release-executor.test.js` ahora reproducen
el inventario del tren cerrado original, solo dentro de ese fixture de pruebas.
No se cambió el ejecutor ni su política en ejecución. Un test adicional confirma
que agregar cualquiera de las migraciones de Instagram sigue siendo rechazado
antes de abrir una conexión. Las pruebas del módulo nuevo usan el inventario real.

## Actualización aditiva 094/095

`inspectInstagramMigration(pool, { environment })` realiza una inspección en una
instantánea de solo lectura. Exige que las únicas migraciones pendientes sean
094/095 y vincula el plan a la identidad exacta de base, usuario y servidor, los
hashes de SQL, el estado de todas las tablas existentes y la política de permisos.

`executeInstagramMigration(pool, approval, { environment, consumeApproval })` no
se ejecuta al iniciar la web ni crea conexiones por sí mismo. Requiere un plan
vigente, evidencia de respaldo/restauración, atestaciones de mantenimiento y un
consumidor externo de aprobación de un solo intento. **Un callback de prueba que
devuelve true no constituye autorización productiva.** Es responsabilidad del
operador verificar y consumir de forma durable esa aprobación; el módulo no puede
probar por sí solo que Hostinger está pausado o que un hash prueba una restauración.

El ejecutor:

1. Conserva el cerrojo de migraciones y bloquea las tablas actuales antes de
   releer el estado. Una tarea nueva o cualquier cambio previo invalida el plan.
2. Ejecuta solo los dos SQL fijados y agrega sus entradas al historial dentro de
   la misma transacción. No reparte, elimina ni restaura tareas/asignaciones.
3. Habilita RLS y revoca acceso a tablas, secuencias y funciones nuevas para
   PUBLIC, anon y authenticated antes de confirmar la transacción.
4. Compara todas las filas originales (incluidos xmin/ctid), columnas, índices,
   restricciones, políticas, permisos y disparadores no internos. Solo admite
   las entradas nuevas esperadas de `_migrations` y las cinco tablas nuevas.
5. Revierte ante error o vencimiento. Si COMMIT es incierto, descarta la conexión,
   informa `INSTAGRAM_COMMIT_UNCERTAIN` y **no reintenta ni afirma rollback**.
   Un rollback puede dejar huecos en la secuencia del historial de migraciones,
   por el comportamiento normal de PostgreSQL; no se renumeran registros.

### Ensayo sobre un archivo local restaurado

La prueba opt-in `backend/test/instagram-migration.integration.test.js` acepta
únicamente un archivo local de respaldo identificado explícitamente mediante
`RENDER2_INSTAGRAM_REHEARSAL_ARCHIVE`, bajo `/private/tmp/render-production-snapshot-*`.
No acepta DATABASE_URL ni utiliza producción. Se habilita con
`RENDER2_RUN_INSTAGRAM_ARCHIVE_REHEARSAL=true` y usa PostgreSQL 18 descartable.

Restaura el respaldo sin cambiar sus bytes, prepara en esa copia la línea base
ya publicada y ensaya **por separado** la actualización de Instagram. Comprueba
rechazo de planes obsoletos, una tarea posterior al respaldo, rollback de ambos
SQL ante un fallo tardío, preservación de filas y generadores de IDs, cierre de
permisos incluso con defaults públicos permisivos, y acceso de dueño/empleado.
Al finalizar retira solo el entorno generado; conserva el respaldo original.

Este ensayo no prueba el estado vigente de producción: antes de publicar se
necesitan un respaldo actualizado y restaurable, la inspección/autoridad productiva
correspondiente y la configuración autorizada de Meta. No se debe restaurar la
copia del ensayo encima de la base actual.

Orden de publicación: mantenimiento verificado → respaldo actual y restauración
probada → inspección/aprobación de 094/095 sobre la base vigente → actualización
aditiva → arranque del artefacto compatible → pruebas de acceso y persistencia →
reapertura. Una aprobación del ensayo local no sirve para este paso productivo.
Si falla la aplicación, mantener mantenimiento y usar un artefacto compatible con
094/095: una versión antigua que no contiene esos SQL puede rechazar el historial
nuevo. No borrar las tablas ni restaurar un respaldo viejo para revertir la interfaz.

# Fase 2 — Panel (`/instagram`, solo Líder)

API bajo `/api/instagram` (cada pedido verifica rol `admin`, cuenta activa y
`session_version` contra la base): `GET /panel`, `GET /clientes/:clave/piezas`,
`GET /cuentas`, `PUT /cuentas/:igUserId`, `PUT /media/:igMediaId/vinculo`.

# Fase 3 — Automatizaciones

## Alertas (`backend/src/instagram-alerts.js`)

Se calculan al abrir el panel; no envían mensajes. Cada una muestra los números que la dispararon.

| Tipo | Regla |
|---|---|
| `cupo_atrasado` | Desde el día 7: piezas publicadas < cupo × (día/días del mes) − 1. En meses cerrados: cupo sin cumplir. |
| `caida_alcance` | Alcance promedio por pieza del mes < 70 % del de los 3 meses anteriores (mín. 4 piezas de base y 2 del mes). |
| `sin_publicar` | Mes actual, con cupo: 7 días o más sin reel/carrusel. |
| `sin_vincular` | Posts del mes sin pieza del sistema (no cuentan para el equipo). |
| `sin_sincronizar` | Cuenta sin sincronizar hace más de 24 h. |

## Reporte semanal (job `instagram_reporte`, migración 095)

Cada corrida verifica si existe el reporte de la última semana completa
(lunes a domingo, Córdoba); si no, lo crea. Los **hechos** los calcula SQL.
Las **conclusiones** con IA son opcionales y solo se piden con:

```
INSTAGRAM_AI_REPORTS_ENABLED=true
ANTHROPIC_API_KEY=...            # secreto, solo en el ejecutor
INSTAGRAM_AI_MODEL=...           # identificador exacto del modelo a usar
RENDER_AUTOMATION_JOBS=...,instagram,instagram_reporte
```

Se envían a la API de Anthropic solo los hechos agregados (nombres de clientes,
métricas, primeros 120 caracteres del texto de las piezas destacadas y nombres
del equipo). Si la IA falla se guarda `ia_error` y se reintenta cada 6 h.
Es independiente de `MIA_SUPERVISOR_REASONING_ENABLED`, que sigue apagado.

## Reporte mensual al cliente

`/instagram/reporte?cliente=<clave>&periodo=YYYY-MM` (botón “Reporte para el
cliente” en el detalle). Se exporta con “Guardar como PDF” del navegador.
No incluye responsables ni vínculos internos.
