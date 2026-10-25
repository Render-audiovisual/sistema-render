# Identidad retenida en avisos privados nuevos — corte278

## Hallazgo y alcance

`backend/src/private-task-notifications.js`, `encolarNotificacionPrivadaTarea`: la rama de compatibilidad resolvía un único usuario activo, pero descartaba su ID al construir detalles. `task-notification-eligibility.js` conserva expresamente la rama histórica sin ID; esos avisos nuevos eludían sus comprobaciones de actividad, WhatsApp y propiedad actual de la clave. Se reprodujo elegibilidad indebidamente conservada tras desactivación en fixture. Es una brecha de identidad del aviso, no una demostración de envío externo o exposición financiera.

Todo aviso nuevo conserva `destinatario_usuario_id` resuelto; `actor_usuario_id` solo cuando el caller aporta actorId verificado. No se inventa el actor desde su nombre. Se mantienen resolver único/activo, aliases de compatibilidad, exclusión de autor, fingerprint antiguo de la rama por nombres y ON CONFLICT DO NOTHING. Los consumidores existentes de ID revalidan el destinatario; no se amplía su SQL ni autoridad. Sin migración ni cambios de servidor/frontend.

## Compatibilidad intencional

- Los históricos sin ID no se rellenan ni reinterpretan; replay con su fingerprint conserva fila/metadata originales. Sus pendientes siguen con la semántica legacy y son un riesgo separado, no resuelto aquí.
- Una clave normalizada por acentos no demuestra propiedad de la ruta. Login acentuado sin coincidencia directa ni alias propio habilitado produce aviso retenido/no elegible. Alias propio habilitado permite elegibilidad; deshabilitado o ajeno no. Se requieren bindings aprobados, no aprovisionamiento automático ni normalización SQL adicional.
- No prueba la entrega al proveedor ni todos los consumidores, la carrera posterior al SELECT de elegibilidad o revocación atómica respecto de un envío externo ya iniciado. No elimina aliases históricos ni decide el revisor adicional pendiente.

## Pruebas reproducibles

Harvey escribió únicamente `backend/test/render2-legacy-task-recipient-binding.integration.test.js` y revisó el diff; coordinador leyó y ejecutó la prueba, integró producto y unitarias y actualizó tres expectativas de metadata. Security-best-practices/Express y Superpowers orientaron identidad, aislamiento y límites.

Antes: dos fallos unitarios de metadata y primera aserción física ID ausente frente a91003; también falló el rechazo tras desactivar destinatario. Los restantes fallos físicos en cascada por restauración no ejecutada no son reproducciones independientes.

Después:95focales PASS; regresión `npm test` desde backend2333PASS/150integraciones opt-in omitidas/0FAIL, salida0. La primera regresión detectó una expectativa anterior que exigía ausencia del ID; actualizada para exigir los IDs correctos sin quitar assertions de resolución.

Comando físico desde backend:

```sh
RENDER2_RUN_LOCAL_INTEGRATION=true node --test --test-concurrency=1 test/render2-legacy-task-recipient-binding.integration.test.js test/render2-legacy-notification-active.integration.test.js test/render2-task-legacy-recipient-ambiguity.integration.test.js
```

14PASS/0FAIL/0SKIP, salida0. Tres clusters generados: PG55908/55880/55897; cleanup ENOENT72iWkn/LbVt9M/8dGkq0 confirmado.106tablas públicas observadas por fixture; nueva suite verifica hashes fuera de cambios explícitos de usuarios/cola, revalidación de solo lectura, replay, revocación, reutilización de login, WhatsApp, nombres ambiguos y aliases acentuados. Helpers reales con adaptador SQL, no recorrido HTTP/navegador. Las dos regresiones usan SMTP inyectado en memoria: ningún envío real. No bases configuradas ni cambios de permisos reales.

Logs en `/private/tmp`: `render2-goal278-unit-red.log`, `physical-red.log`, `focal-final.log`, `backend-final.log` y `physical-final.log` con el mismo prefijo render2-goal278. No nuevo buildfrontend, despliegue ni aceptación global.
