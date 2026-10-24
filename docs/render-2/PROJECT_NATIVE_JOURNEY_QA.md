# Prueba local de proyectos de Desarrollo

El recorrido conectado verificó la creación de un proyecto web, sus etapas, hitos, entregables y una tarea existente desde la interfaz real. La aprobación corresponde a una versión concreta del entregable y se invalida al cambiar su contenido. El proyecto no genera cuotas mensuales de contenido. Es aceptación parcial local, no autorización de despliegue.

## Entorno y responsabilidades

Se usaron Express y PostgreSQL descartables en los puertos52802 y55834, con identidad y directorio exactos comprobados antes de consultar datos. Todos los registros operativos se crearon mediante el navegador; no se importaron clientes ni datos comerciales. Los enlaces example.invalid son referencias de prueba y no se abrieron.

Hypatia y Carver revisaron contratos y criterios en modo de solo lectura. El coordinador ejecutó las acciones nativas y las comprobaciones SQL. No se modificaron componentes del producto en este recorrido. Las skills de trabajo estructurado, verificación y documentación orientaron las comprobaciones y sus límites.

## Recorrido verificado

1. Franco QA creó un cliente sin acuerdo mensual y un proyecto web con responsable Designer QA, miembro Luciano QA y fechas independientes de inicio y entrega.
2. Tras cerrar sesión e ingresar como Designer QA, el responsable no administrador creó una etapa, un hito fechado y un entregable en revisión. No disponía del botón de crear o archivar proyectos ni de los accesos administrativos financieros.
3. El responsable revisó y aprobó explícitamente la versión1. Cambiar enlace y observaciones devolvió el entregable a revisión, eliminó la aprobación vigente y conservó el registro histórico. La versión2 requirió una nueva confirmación de revisión. Autor y aprobador fueron el mismo responsable; no demuestra separación de personas.
4. La recarga conservó la versión2 aprobada, la etapa y el hito. Tres recibos de creación correspondieron a los tres recursos, con actor estable y revisiones esperadas1,2,3.
5. Designer QA creó la tarea web con cliente, responsable, instrucciones, prioridad y entrega28/10/2026. Desde el proyecto consultó su ID y revisión, eligió la etapa y la vinculó sin copiarla. El vínculo sobrevivió a la recarga.
6. Desde ese vínculo abrió la tarea y cambió de pendiente a en proceso y a Para revisar. El proyecto mostró En revisión, revisión de tarea3, conservando su propio estado Planificado y revisión8.

## Comprobación independiente de PostgreSQL

Los observadores utilizaron transacciones REPEATABLE READ READ ONLY e identidad exacta de la base temporal. Las comprobaciones de versión1, edición, versión2 y vínculo final pasaron. La primera expectativa del observador final usó el rótulo para_revisar; se corrigió a en_revision, el estado canónico realmente almacenado. No fue una corrección del producto.

El corte final confirmó un proyecto, una tarea, un vínculo a su etapa y fecha de entrega28/10/2026. Los dos registros históricos de aprobación y el entregable aprobado coincidieron íntegramente con el corte anterior al vínculo. Permanecieron en cero publicaciones, historias, piezas de objetivos, eventos de publicación, objetivos mensuales, configuraciones de acuerdo y pagos del equipo.

Scripts y cortes temporales: `/private/tmp/render2-project177-native.mjs`, `/private/tmp/render2-project177-observe.mjs`, `/private/tmp/render2-project177-linked.mjs` y `/private/tmp/render2-project177-{v1,edited,v2}.json`. Son evidencia temporal, no una suite portable del repositorio.

El harness terminó con código0 y comprobó ENOENT del directorio `/private/tmp/render2-local-YBrvAs`. Se eliminaron únicamente sus datos sintéticos descartables. No se detuvieron otros servicios PostgreSQL.

## Vista móvil

La vista de detalle a390×844 mostró el menú contraído y tarjetas legibles. documentElement y body midieron390px de ancho, sin desbordamiento horizontal. Captura: `/private/tmp/render2-project177-mobile.png`. Se restauró el viewport. No se probó en un teléfono físico ni se completaron todos los formularios móviles en este corte.

## Pendientes de aceptación

El corte siguiente cubrió lectura del miembro, denegaciones API, aprobación y finalización, Inicio y Calendario. Siguen pendientes los formularios completos móviles, dispositivos independientes, aceptación transversal de módulos y condiciones de hosting.

## Cierre de tarea y contexto de Desarrollo

Dos clústeres nuevos en55836 con HTTP52803 extendieron el recorrido. El cliente, proyecto, hito y tarea se prepararon mediante la API real, no mediante acciones nativas de creación. Con sesión cookie de Franco QA, Inicio mostró la tarea en la cola del equipo. La aprobación y finalización nativas dejaron la tarea en revisión5 y el proyecto Planificado en revisión3, con1/1 tareas finalizadas. La sesión nueva de Luciano QA pudo leer el proyecto sin controles estructurales, verlo en Mis proyectos y consultar su hito el28/10 en Lo mío. La tarea ajena no apareció como entrega personal. El calendario a390px no desbordó horizontalmente.

La primera ejecución detectó una presentación incorrecta: Desarrollo ofrecía Objetivo del mes y Publica opcional. Se añadió un clasificador de presentación por tipo/subtipo explícitos, sin inferencias desde títulos ni personas. Oculta esas opciones en Desarrollo, Administración y formatos web/chatbot/mantenimiento/automatización; conserva casos editoriales, desconocidos compatibles y vínculos editoriales históricos explícitos. También impide el envío con publicador desde ambos callbacks de la interfaz. No cambia ACL, estados ni endpoints del backend y no es una barrera de seguridad del servidor.

El segundo clúster sirvió el build corregido `index-CTgh19V3.js`. El navegador confirmó texto de aprobación neutro, ausencia de ambas opciones y botón de aprobación conservado. Desde390×844 se aprobó y finalizó la tarea; la recarga conservó Finalizada, cliente y entrega. Capturas: `/private/tmp/render2-project178-web-review.png`, `/private/tmp/render2-project178-web-review-mobile.png` y `/private/tmp/render2-project178-member-calendar.png`. Se restauró el viewport. La especialización posterior del brief para Desarrollo, con persistencia del contenido heredado, está verificada por alcance en DEVELOPMENT_TASK_BRIEF_QA.md.

Los dos cierres nativos comprobaron cero historias, publicaciones, eventos de publicación, piezas/objetivos mensuales, configuraciones de acuerdo y pagos. Ambos terminaron con código0 y ENOENT de `/private/tmp/render2-local-po2EQ6` y `/private/tmp/render2-local-YWQpBj`. Solo se eliminaron datos sintéticos propios.

## Regresión reproducible

Carver añadió `backend/test/render2-project-workflow-journey.integration.test.js`: cliente sin acuerdo, proyecto web, etapa/hito, tarea, vínculo, denegaciones sin cambios, estados por rol y proyecciones personales tras nuevas sesiones. La primera ejecución detectó una expectativa de fixture incorrecta: las migraciones incluyen un grupo de feed histórico. La prueba final conserva y compara ese baseline; no elimina el grupo. Pasó5 pruebas con cero omitidas, y cleanup ENOENT de `/private/tmp/render2-local-1sSoAI` (el intento previo también limpió su clúster).

La cohorte `render2-projects.integration.test.js` y `render2-calendar-projects.integration.test.js` pasó28 pruebas físicas con cero omitidas y limpieza verificada de `/private/tmp/render2-local-Le3m8P` y `/private/tmp/render2-local-rJLvuh`. En conjunto son33 pruebas físicas de este corte, no33 recorridos de navegador.

Poincare implementó el clasificador y sus guards, con pruebas de JSX y callbacks reales extraídos. Hypatia revisó la cobertura por ID en modo de solo lectura. El coordinador integró las dependencias nuevas en los tests de sesión/asignación, corrió la regresión y repitió la comprobación nativa. Pasaron2372 pruebas frontend; `npm test` backend pasó1982 y omitió121 integraciones opt-in. Build y diff-check pasaron. Logs finales: `/private/tmp/render2-audit178-frontend-final.log`, `/private/tmp/render2-audit178-backend-canonical.log`, `/private/tmp/render2-audit178-build.log`.

Un descubrimiento inicial demasiado amplio con `node --test` incluyó tests heredados de sandbox y scripts fuera del comando canónico; falló con EPERM en conexiones sandbox y se descartó como regresión válida. No se repitió con privilegios. El comando válido es `npm test` dentro de backend, acotado a `test/*.test.js`. Dos pruebas de callbacks necesitaron inyectar la nueva dependencia pura, sin relajar sus comprobaciones de sesión. No se modificó producto backend ni se desplegó.
