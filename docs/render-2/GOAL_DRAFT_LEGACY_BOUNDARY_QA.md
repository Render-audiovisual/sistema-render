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

Actualización193: el recorrido nativo del alias y recuperación se completó como se describe debajo. Quedan ACK perdido nativo, demás formularios y aceptación global del sistema. No se promete conservar un borrador ante una retirada de confianza de sesión, cierre de pestaña o recarga aceptada.

## Actualización193: navegador conectado

Se utilizó el build index-DZ7Ii23D.js sin modificar su bundle, conectado a Express y un clúster PostgreSQL nuevo mediante render2-local-test.js. El runner temporal `/private/tmp/render2-goal193-native.mjs` verificó identidad de fixture, preparó por API una pieza del cliente sintético QA193 Cliente alias asignada a Luciano y capturó nueve tablas comerciales.

Para alcanzar un alias dentro del documento sin depender de un enlace obsoleto del producto, se añadió temporalmente a dist/index.html un módulo externo qa193.js. Su único control visible hacía pushState a /luciano y emitía popstate; no accedía a React, al almacén, a sesiones ni a APIs. Por tanto la entrada de navegación fue instrumentada, mientras App, replaceLegacyRoute, provider, editor y lecturas API fueron reales. No se presenta este control como una función del producto ni como una prueba de navegación con Atrás. El script se eliminó y el HTML quedó restaurado al terminar.

Luciano inició sesión, abrió Reel1 y escribió `QA193 borrador conservado al recorrer alias`, sin guardar. Pulsó el control de QA: la URL terminó en /inicio?editorial_view=today&editorial_page=0, con el aviso Contenido sin guardar visible. Retomar abrió /clientes?borrador=1&cliente=1&periodo=2026-10 y el textarea contenía exactamente el texto anterior. La pieza seguía mostrando que no tenía copy guardado. Esto verifica conservación observable durante alias → canónico, no una traza directa del cleanup ni una lectura nativa de CAS.

Se repitió el alias desde el editor, se cerró sesión mediante el menú real y se inició como Designer. Inicio mostró la nueva identidad sin aviso ni texto heredado. Este cierre ocurrió después de completar la transición; no se probó una carrera de logout durante el render transitorio.

Al finalizar, las nueve tablas comerciales fueron idénticas al snapshot posterior a la preparación: cero escrituras operativas de la UI. El runner terminó0 y confirmó ausencia de `/private/tmp/render2-local-yIjWvA`. Se cerró solo la pestaña12 creada para QA. El primer intento de initdb dentro del sandbox fue rechazado por el sistema operativo; el intento autorizado fuera del sandbox ejecutó el fixture. No se inspeccionaron ni alteraron bases configuradas.

Capturas: `/private/tmp/render2-goal193-alias-restored.png` y `/private/tmp/render2-goal193-other-identity.png`. No se renovaron suites ni build en193: se verificó nativamente el build aprobado en192. Sin cambios adicionales de código de producto ni despliegue.
