# WhatsApp canónico — preparación local de publicación

## Alcance y estado

El usuario confirmó conservar las dos funciones antes de publicar: edición desde una visita parcial y finalización privada. Se implementan sobre los contratos canónicos existentes, no copiando el cierre antiguo que publicaba piezas. Sin nueva migración, despliegue, push, cambios de credenciales del hosting o escritura productiva.

Main integra rutas, CLI, pruebas HTTP, copia restaurada y paquete. Hilbert implementa finalización y sus pruebas de fallos/bloqueos. Fermat implementa edición por video y revisa el cierre independientemente. Archivos compartidos con integración única; no se sobrescriben previews/sandbox no versionados.

## Contratos implementados

- `POST /tareas/resolver-finalizacion`, `/lotes/finalizacion/previsualizar`, `/lotes/finalizacion/confirmar`: únicamente WhatsApp privado, firma v2 exacta e identidad activa unívoca por ID. Resumen numerado, selección, revisiones, pertenencia, rol y observación de visita quedan ligados al token de quince minutos. Cambiar de selección reemplaza previews pendientes, no recibos anteriores.
- El cierre valida aprobación y preparación audiovisual, bloquea tareas en orden y revalida identidad/rol/pertenencia. El vencimiento se reclama con reloj real después de esperar todos los bloqueos. Token, CAS, tareas, auditoría y recibo se confirman o revierten juntos. Replay autorizado devuelve el recibo sin repetir mutaciones. No altera publicaciones, fechas reales ni cuotas.
- Aviso de finalización restaurado después del commit, dirigido a IDs de administradores actuales, nunca a nombres de transporte. Solo primera ejecución; un error de notificación no convierte un cierre comprometido en fallo ni provoca renotificación en replay. Es best-effort, no una garantía de entrega de WhatsApp real.
- `GET /produccion/visitas/:visitaId/videos`, `POST /produccion/edicion/previsualizar` y `/produccion/edicion/confirmar`: editor ID, fecha de entrega, video UUID y revisión explícitos. No exige completar toda la visita; sí video grabado, cliente/origen/material compatibles. La notificación se confirma como parte de la intención (`true` por defecto o `false` explícito).
- Web y WhatsApp reutilizan `dispatchProductionVideoEditing` en `production-registry.js`. El hook de confirmación se ejecuta bajo los bloqueos canónicos y antes de crear o recuperar una tarea. Un video conserva una tarea; confirmaciones simultáneas o repetidas no crean una edición agregada paralela.
- Origen histórico por conteo o `tarea_origen_id`/`tarea_padre_id` sin video canónico: 409 con instrucción explícita de conciliación. No se inventan videos ni se reinterpretan automáticamente guiones/material antiguo. Se requiere actualizar las instrucciones del agente externo a estos comandos; copiar el CLI al hosting no actualiza automáticamente su VPS.

CLI canónico `backend/scripts/mia_render_os_task.py` y wrapper existente: `resolve-finalization`, `preview-finalization`, `confirm-finalization`, `production-videos`, `preview-video-editing`, `confirm-video-editing`. Documentación de uso en `tools/wilson/README.md`; flags de identidad antes del subcomando. CLI no firma/envía durante pruebas offline, no consulta una revisión nueva ni reintenta automáticamente para evadir conflictos.

## Verificación aislada

Prueba permanente `render2-wilson-release-parity.integration.test.js`: HTTP real firmado, claves efímeras, usuarios sintéticos y PostgreSQL recién creado. Cierre aprobado, replay/concurrencia, revocación, vencimiento, papelera, grupos, edición individual de dos videos con editores/fechas distintos y pendiente conservado. Invariancia física de publicación y de tareas después de replay. Incluye espera física de visita y vencimiento de token de edición mientras espera.

`render2-wilson-finalization-locks.integration.test.js`: vencimiento después de bloqueos físicos de ámbito/token/tareas/visita y rollback por fallos de auditoría/recibo. Ambas pruebas se agregan a la cohorte principal, ahora43 archivos. Fixtures se detienen y eliminan con comprobación ENOENT.

La regresión ampliada detectó un fixture antiguo que omitía091 al diferir059. Se actualiza exclusivamente el test para aplicar el SQL real después de comprobar invariancia histórica; no se cambia una migración ni la base productiva. Producciones y bloqueos de finalización:26PASS/0FAIL al repetir esa prueba.

### Otra copia de la restauración real

Se crea `render2_whatsapp_release_20261026` como copia local de `render2_upgrade_test`, dentro del cluster privado `/private/tmp/render2-upgrade-LZZ5OA`, PostgreSQL18.4. No se usan credenciales productivas. Se exige el directorio/identidad conocidos y que el cluster esté detenido antes de iniciar. No se modifica su HBA: el socket local existente permite administrar la copia; la red externa está denegada.

La copia de origen tenía343 tareas al iniciar esta etapa (338 del respaldo inicial y cinco registros locales adicionales ya presentes; no se clasifican ni eliminan). Se preservan **todos** sus registros presentes, no solo el conteo histórico338. Las111 tablas de la nueva copia coinciden inicialmente por contenido, xmin y ctid. Solo se agregan cuentas y registros sintéticos en la nueva base; ninguna cuenta existente cambia de rol, asignación o contraseña.

HTTP firmado sobre los módulos reales confirma edición individual con editor/entrega, replay y cierre explícitamente aprobado. Al terminar, todas las filas preexistentes de las111 tablas de la copia de prueba conservan contenido, xmin y ctid. La base local de origen también conserva su huella completa. Cluster detenido/PID ausente. Resultado privado: `whatsapp-release-rehearsal.private.json` en la carpeta privada; log agregado `/private/tmp/render-whatsapp-copy-rehearsal.log`. Esto no certifica cambios posteriores del sistema vivo.

Primer intento abortó antes de conectar porque el binario predeterminado había cambiado a PG16. Se seleccionó explícitamente PG18.4, sin cambiar la configuración. Un segundo supuesto obsoleto de338 tareas se rechazó y se reemplazó por preservación de todas las filas observadas. El acceso TCP a otra base se rechazó; se utilizó el socket permitido, sin debilitar el control de acceso. Ninguno de esos intentos escribió datos comerciales.

## Paquete regenerado

`/private/tmp/render-whatsapp-release-XOSHXD/app`:328 archivos de aplicación, ocho dependencias resueltas dentro del artefacto. Manifiesto SHA256 `acc91376bbe4a0813e121b47e65e10090639dfc2d7ad52a58081ad358a3ea96f`. Destino nuevo, sin sobrescribir candidatos anteriores y sin .env/dumps/claves privadas. Frontend recompilado del mismo origen, asset `index-MhFIu74X.js`; no cambio visual en esta etapa.

Smoke **del artefacto**, usando su servidor, dependencias y frontend: arranque, hash del asset servido, sesiones cookie/CSRF independientes, tarea por ID con edición/recarga, empleado sin acceso financiero, reportes operativos, preview/confirm/replay de edición y finalización WhatsApp con firma sintética. Nueve controles PASS, archivos y dependencias invariantes, procesos detenidos/fixture eliminado ENOENT. Red del servidor limitada a su PG local; ningún proveedor real contactado. Evidencia `artifact-smoke.json` junto al paquete y `/private/tmp/render-whatsapp-artifact-smoke.log`.

## Resultados finales reproducibles

- Backend general:2.858PASS/182opt-inSKIP/0FAIL de3.040; `/private/tmp/render-whatsapp-backend-final.log`. Ejecutado otra vez después de las14 regresiones de notificación.
- Cohorte física43archivos:375PASS/0FAIL/0SKIP en102,23s; `/private/tmp/render-whatsapp-core-final.log`. Incluye ambos recorridos, vencimiento real de edición bajo espera de visita y los bloqueos/fallos del cierre. Ejecutada tras el último cambio de código productivo.
- Focales antes de las14 regresiones de aviso:101PASS/0FAIL. Archivo final de finalización:74PASS/0FAIL, incluido después en la suite general. CLI offline:19PASS/0FAIL.
- Regresión ampliada fuera de la cohorte: Producciones completo y bloqueos de finalización26PASS/0FAIL, tras corregir el fixture diferido. Los otros recorridos editorial/concurrencia de la primera ejecución pasaron; el fallo inicial del fixture no se presenta como aceptación.
- Copia restaurada PG18.4: ambos flujos y conservación física de todas las filas preexistentes de111tablas, y base local de origen intacta. Los fixtures nuevos de esta etapa usan el binario predeterminado actual PG16.14; no se los etiqueta como PG18 ni se afirma probar el PG17 productivo.
- Node24.18.0. Build frontend correcto, mismo asset MhFIu74X. Sin cambios de componentes visuales; no nueva inspección móvil ni nueva suite frontend completa en esta etapa.
- Paquete: nueve controles smokePASS y0vulnerabilidades runtime conocidas según npm audit al26/10,121dependencias totales. `/private/tmp/render-whatsapp-runtime-audit.json`. El primer intento de audit no pudo resolver npm desde el sandbox; la consulta autorizada de nombres/versiones públicos pasó. No es garantía de seguridad futura ni prueba del servicio real de hosting.
- `git diff --check` correcto. No cambios de esquema, conexiones productivas, migraciones productivas o entregas externas.

## Límites de aceptación y publicación

Esto es implementación y verificación local, **no despliegue ni permiso para migrar producción**. El transporte externo real y sus instrucciones deben actualizarse coordinadamente; los callbacks sintéticos no prueban entrega real. Los comandos P2 de corrección audiovisual y auditoría de edición señalados en el diagnóstico siguen fuera de este cambio: no declarar paridad total de todos los comandos remotos.

Antes de publicar siguen vigentes: preflight vivo actualizado, respaldo fresco de DB/archivos/configuración, cuentas de dueños reales verificadas, revisión de ACL/servicios/runtime Hostinger, ventana y rollback acordados, y mecanismo productivo forward-only revisado. No restaurar esta copia sobre la base actual ni ejecutar seeds/históricos. Los CLI locales mantienen su bloqueo de producción.

Las guías Superpowers y PostgreSQL orientaron separación de responsabilidades, contratos y pruebas después de bloqueos; no se incorporó un producto ni esquema Supabase nuevo.
