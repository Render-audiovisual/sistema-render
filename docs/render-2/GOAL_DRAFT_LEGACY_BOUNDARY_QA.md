# Borrador durante redirecciones heredadas

Corte192: corrección implementada localmente, sin cambios de backend, datos ni despliegue.

## Hallazgo y corrección

App devolvía RouteLoading como raíz al entrar en un alias heredado, aunque la sesión siguiera autenticada. Eso desmontaba GoalDraftMemoryProvider y su cleanup eliminaba el borrador antes de replaceLegacyRoute y del popstate canónico.

El retorno de alias ahora mantiene el mismo tipo de provider en la misma posición raíz, con la misma key opaca sessionRenderEpoch y la misma sesión; solo cambia su contenido a RouteLoading. El retorno del dashboard no cambia. No se usa un singleton global, almacenamiento del navegador ni credenciales en claves React.

Los gates de sesión unknown/loading/error, login y ausencia de sesión siguen retirando el provider. No se extiende la memoria a una nueva identidad, a una recarga completa ni a una sesión cuya confianza se está verificando. Las rutas que realizan navegación completa siguen fuera de esta garantía.

## Verificación

La nueva prueba en section-focus-integration.test.js ejecuta App extraído mediante SSR y comprueba por AST que ambos retornos tienen exactamente el mismo elemento raíz, key y props. Comprueba provider presente para /agustin, /franco, /luciano?task=12, /piezas, /equipo e /inicio, y ausente para estados de verificación o login. Conserva las pruebas de foco y las garantías existentes de ownership/ABA del almacén.

27 pruebas focalizadas aprobadas. Regresión frontend:2508 aprobadas, cero fallos u omisiones. Build index-DZ7Ii23D.js correcto; diff-check correcto. Logs /private/tmp/render2-goal192-frontend.log y /private/tmp/render2-goal192-build.log.

Esta evidencia es de contrato de raíz, SSR y kernels; no se presenta como reconciliación React montada ni recorrido nativo de un alias. Falta renovar ese recorrido conectado en navegador. No se renovaron pruebas backend porque no hubo cambios allí.

Volta revisó el diff de forma independiente, sin editar archivos ni iniciar servicios: sin hallazgos accionables. Señaló mantener como pendiente la continuidad real de instancia y la respuesta tardía de un guardado durante el desmontaje del editor; el almacén conserva su política incierta, sin inferir éxito.

## Pendientes

Recorrido nativo del alias y recuperación, ACK perdido nativo, demás formularios y aceptación global del sistema. No se promete conservar un borrador ante una retirada de confianza de sesión, cierre de pestaña o recarga aceptada.
