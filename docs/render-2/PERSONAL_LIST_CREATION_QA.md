# Creación recuperable de páginas personales

La creación de páginas de Mi lista incorpora una clave de operación por usuario y un recibo transaccional en PostgreSQL. Si se pierde la respuesta, la interfaz conserva el mismo intento en memoria y permite consultarlo antes de reenviar. Dos creaciones intencionales con títulos y contenido iguales siguen siendo distintas cuando usan claves distintas. Desarrollo local, sin despliegue.

## Contrato de creación y recuperación

POST `/api/listas-personales` exige `request_id` UUID junto con `titulo`, `emoji` y `bloques`. La ausencia de clave produce 428 y una clave inválida produce 400. El servidor normaliza el contenido y calcula un hash determinista sin almacenar el texto en el recibo. Una misma clave con contenido distinto produce 409.

La primera creación devuelve 201; repetir la misma clave y contenido devuelve 200 con la página actual, no una copia histórica del contenido. Ambas respuestas incluyen `creation_request_id`. GET `/api/listas-personales/creaciones/:requestId` consulta el resultado dentro de la identidad autenticada. Una clave desconocida para ese usuario devuelve 404; una página eliminada con recibo existente devuelve 409 y no se recrea.

La autoridad se captura antes de solicitar conexión y se revalida en la transacción contra el usuario activo, rol y versión de sesión. La creación mantiene un bloqueo exclusivo del usuario durante la comprobación del límite, cálculo de posición, inserción de página, sección, bloques y recibo. Esta adquisición no utiliza una conversión de bloqueo SHARE a UPDATE. La recuperación utiliza un bloqueo compartido. Los IDs BIGINT se conservan sin convertirlos a números imprecisos.

## Esquema y compatibilidad

La migración aditiva `087_personal_list_create_receipts.sql` define `personal_list_create_receipts` con `actor_user_id`, `request_id`, `payload_hash`, `list_id` y `committed_at`. Su clave primaria combina usuario e intento. El recibo conserva `list_id` sin borrado en cascada desde la página; un trigger impide modificar o borrar recibos. No hay backfill ni reinterpretación de páginas existentes.

El arranque debe exigir el esquema nuevo mediante inspección de solo lectura y ledger aprobado. El servidor no aplica esta migración automáticamente. Frontend y backend requieren un corte coordinado: un cliente antiguo que cree páginas sin clave recibe 428. Los fixtures existentes deben enviar claves al crear páginas; no se añaden claves a operaciones de edición o plantillas.

## Interfaz y límites

`personalListCreation.js` mantiene una intención inmutable por vida de sesión. Una respuesta perdida, un fallo de servidor o una confirmación inválida deja el intento pendiente de verificación. Una consulta 404 permite reenviar explícitamente el mismo cuerpo y la misma clave. Una denegación de sesión retira la intención privada. Una respuesta solo se acepta si coinciden la clave y la estructura renderizable, incluidos IDs, versiones y relaciones de bloques y secciones.

`PersonalLists.jsx` integra ese modelo con la cola de guardado y el bloqueo de operaciones estructurales. La recuperación no reemplaza borradores locales ni agrega otra fila para el mismo ID. No se almacena contenido comercial ni la intención de creación en LocalStorage. Recargar o abandonar una página con resultado incierto requiere advertencia; después de abandonar esa vida de interfaz se debe consultar el inventario real antes de iniciar otra creación.

El alcance es crear páginas. Crear plantillas o agregar bloques son operaciones separadas y no quedan protegidas por este recibo.

## Pruebas y estado de aceptación

Las pruebas físicas requieren PostgreSQL aislado y la activación explícita `RENDER2_RUN_LOCAL_INTEGRATION=true`. En este corte siguen pendientes por el límite SysV del equipo. No se ejecutan migraciones sobre bases configuradas, no se limpian segmentos IPC y no se intervienen servicios ajenos. Una prueba de componente con transporte sintético no acredita persistencia en PostgreSQL.

Pasaron 48 pruebas focales de backend y 46 de frontend. Las suites completas finalizaron con 2296 aprobadas de frontend, cero fallos y cero omitidas; backend tuvo 1955 aprobadas, cero fallos y 119 omitidas con integración física desactivada. El build pasó con entrada `index-BFmyXIOE.js`. Los dobles transaccionales cubren concurrencia, límite, orden y rollback, pero no prueban el motor PostgreSQL. La nueva suite física quedó escrita y su sintaxis se verificó; no se activó.

Comandos reproducibles desde sus respectivos directorios:

```sh
# frontend
node --test src/pages/personalListCreation.test.js src/pages/personalListCreationIntegration.test.js src/pages/personalListPersistence.test.js src/pages/personalListsSession.test.js src/pages/personal-list-location.test.js src/pages/personal-template-dialog.test.js
node --test $(rg --files src -g '*.test.js')
npm run build

# backend
node --test test/personal-list-create-receipts.test.js test/personal-list-cas.test.js test/personal-lists.test.js test/startup-schema.test.js test/migrations-policy.test.js
RENDER2_RUN_LOCAL_INTEGRATION=false npm test
node --check test/render2-personal-list-create-receipts.integration.test.js
```

Logs finales: `/private/tmp/render2-personal164-focused-backend.log`, `/private/tmp/render2-personal164-focused-frontend.log`, `/private/tmp/render2-personal164-backend-release.log`, `/private/tmp/render2-personal164-frontend-final.log` y `/private/tmp/render2-personal164-build-release.log`.

## Prueba visual aislada

El script temporal `/private/tmp/render2-personal164-browser.mjs` compila `PersonalListsPage` y los componentes, modelo, guard de navegación y estilos reales bajo React StrictMode. Sustituye únicamente sesión y transporte por respuestas sintéticas en memoria; la política de contenido bloquea conexiones externas. No es una nueva implementación operativa ni una prueba de persistencia.

El primer POST sintético crea la página y después pierde la respuesta. El modal conserva la advertencia y deshabilita todas las plantillas. Verificar abre la página mediante su URL `?lista=1`; el contador mantiene una página, una escritura y un recibo. A 390 × 844 el documento mide 390 px, sin desbordamiento. Una segunda creación intencional del mismo Plan diario produce otro ID y otro recibo. Un tercer intento pierde su respuesta; cerrar el modal conserva el aviso dentro del documento y el estado Sin guardar, sin alterar las dos columnas del escritorio. Verificar recupera `?lista=3`, con tres páginas y solo tres escrituras totales. La consola no registró errores ni advertencias.

Capturas: `/private/tmp/render2-personal164-mobile-pending.png` y `/private/tmp/render2-personal164-desktop-confirmed.png`. El primer pase del script tenía una cabecera sin charset; se corrigió únicamente el fixture y se repitió el recorrido con UTF-8. Se cerró la pestaña propia, se restauró el viewport y se apagaron ambos procesos propios de prueba, verificados antes de detenerlos.

## Equipo y revisión

Poincare implementó backend, normalización, migración y pruebas transaccionales. Beauvoir integró modelo, recuperación, ciclo de sesión y pruebas de interfaz. Hypatia adaptó la inspección de esquema y cuatro suites existentes, y revisó independientemente backend e interfaz sin nuevos P1/P2 concretos en ese alcance. Carver escribió la suite física opt-in. El integrador fijó el contrato, revisó los cruces con MIA, detectó y coordinó las correcciones de tombstone y disposición, ejecutó regresiones y comprobó el componente nativo.

OP163-01 queda implementado con aceptación de código y componente, pendiente de aceptación física de PostgreSQL. No se certifica aún para despliegue. El circuito audiovisual nativo conectado, el drop nativo con persistencia, la aceptación visual global y los proveedores reales siguen abiertos en el diagnóstico maestro.
