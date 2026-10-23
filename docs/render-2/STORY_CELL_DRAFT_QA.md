# Historias: protección de ediciones de celdas — revisión 148

## Alcance local

Se conserva la API editorial y PostgreSQL como fuente compartida. Los borradores son efímeros en memoria: no se guardan textos comerciales ni credenciales en localStorage. No hubo migraciones, cambios de esquema, despliegues ni acceso a producción.

## Corrección

- `storyCellDraft.js` registra generaciones por campo y por subcampo de metadata, solicitudes pendientes y guardados inciertos. Una confirmación no limpia una edición posterior ni otro subcampo sin enviar.
- `Historias.jsx` protege la navegación antes del render, bloquea salidas durante solicitudes pendientes y pide confirmación cuando hay cambios sin confirmar. Cancelar conserva el texto; descartar no revierte un posible guardado ya realizado en el servidor.
- Las lecturas iniciadas antes de una edición no sustituyen el borrador ni su evidencia de concurrencia. Las observaciones de publicación se distinguen de las ediciones humanas.
- Un blur duplicado solo comparte la solicitud cuando coinciden cuerpo inmutable, contexto y propietario del borrador. Un blur sin cambios no envía una escritura innecesaria.
- Una solicitud fallida bloquea reintentos implícitos de esa fila. No se rebasa silenciosamente su revisión. Los cambios de contexto autorizados limpian las filas anteriores.

## Coordinación

Integración principal: modelo y Historias; Hypatia: pruebas del modelo; Poincare: pruebas de sesión y concurrencia; Carver: revisión de duplicados y generaciones; Beauvoir: revisión de navegación y descarte. Los agentes no editaron simultáneamente el componente principal.

## Verificación reproducible

- Suite frontend: 2.081 pruebas aprobadas, cero fallos, cancelaciones u omisiones. Comando desde frontend: `node --test src/**/*.test.js src/**/**/*.test.js src/**/**/**/*.test.js src/**/**/**/**/*.test.js`.
- Build de producción local satisfactorio: bundle `index-aeKWV8LS.js`.
- `git diff --check` satisfactorio. Backend sin modificaciones en esta revisión; no se presenta una nueva corrida completa de backend.
- Navegador real y PostgreSQL efímero: edición de copy sin conexión conservada; cancelar salida conservó el borrador; descarte explícito y nueva lectura recuperaron el valor del servidor. La llamada de automatización sin conexión sufrió una demora anómala; la sesión sintética expiró y fue renovada antes de verificar la nueva lectura. No se atribuye esa lectura a una sesión ininterrumpida.
- Una segunda prueba detectó que el blur sin cambios enviaba un PATCH innecesario e impedía la primera navegación; se corrigió y se reconstruyó.
- Bundle final: guardar tipo, esperar ACK, pulsar Inicio una sola vez, volver y comprobar tipo persistido y copy original. SQL final: metadata tipo `QA148 Final`, copy `QA148 Original`, estado pendiente, publicación real nula y cero eventos de publicación.
- Tres clusters propios eliminados por el harness: `render2-local-6yGzpM`, `render2-local-umQvhm`, `render2-local-XvDgkC`. Pestañas de prueba cerradas; emulación de red restaurada y deshabilitada.

## Evidencia y límites

Capturas temporales: `/private/tmp/render2-stories148-retained.jpg` y `/private/tmp/render2-stories148-release-saved.jpg`. Logs temporales: `/private/tmp/render2-stories148-verified-frontend.log`, `/private/tmp/render2-stories148-release-build.log`, `/private/tmp/render2-stories148-release-native.log`.

Esta revisión no proporciona recuperación tras cierre o caída del navegador ni persistencia offline. Se probó visualmente escritorio con administrador sintético, no todos los roles ni móvil. Se mantiene la limitación previamente documentada de navegación Back no cancelable. Los pendientes del diagnóstico 147 (autoridad en Usuarios/Estructura, fallos de lectura de tareas vinculadas y detalles de navegación/diálogos) siguen abiertos. Esta entrega no completa el rescate global ni autoriza un despliegue.
