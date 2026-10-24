# Permiso de edición de contenido en objetivos

Clientes y objetivos ahora ofrece Editar contenido únicamente cuando el servidor indica que la persona actual puede editar la tarea vinculada. La lectura compartida y Abrir tarea se conservan. El cambio corrige una acción que antes abría campos a empleados ajenos y terminaba en404 al guardar; no reemplaza la autorización del servidor ni resuelve todas sus carreras de concurrencia.

## Contrato compartido

GET `/api/cliente-objetivos?periodo=YYYY-MM` añade `puede_editar_contenido`, un booleano por pieza. Se calcula dentro del mismo snapshot de lectura, reutilizando buildTaskAccessClause: dueño o asignación por ID estable, tarea existente en render_os y sin las marcas de papelera o archivo de tarea. Responsable y colaborador califican; nombres iguales, etiquetas históricas y cuentas del cliente no otorgan permiso. Community no obtiene un bypass por ese rol.

readGoals captura ID y rol antes del trabajo asíncrono y los conserva al obtener una conexión. Lecturas internas sin actor o con ID inválido devuelven false. El indicador se proyecta con COALESCE a false para tareas ausentes o sin workspace, sin filtrar piezas históricas ni exponer las asignaciones internas. No cambia cuotas, hashes de preparación ni revisiones.

PieceDetail exige true booleano y un ID válido para mostrar el botón. beginEdit y saveContent también comprueban esa condición antes de solicitar datos. Los controles son UX: PATCH vuelve a comprobar pertenencia y revisión. Una respuesta GET anterior no permite guardar después de quitar una asignación ni sobrescribir una versión nueva.

## Implementación y revisión independiente

El coordinador modificó backend/src/client-goals.js, frontend/src/pages/ClientesObjetivos.jsx y la dependencia del fixture de sesión existente. Erdos añadió únicamente goalPieceEditCapability.test.js:27 casos de JSX real renderizado con SSR y callbacks extraídos. Cubren true estricto, ausencia de permiso, tareas ausentes, conservación de Abrir tarea y lectura seguida de guardado con versión observada. No son navegador montado.

Volta revisó de forma independiente el contrato, la consulta, la recursión de conexiones y los límites del escritor, sin encontrar defectos accionables en el cambio de lectura. Las guías de seguridad y PostgreSQL orientaron la reutilización del ACL y del índice existente por tarea y usuario; no se añadieron migraciones ni dependencias. La guía de documentación mantiene este informe dentro del repositorio local.

## Pruebas con PostgreSQL

La suite nueva render2-goal-content-capability.integration.test.js usa un clúster fresco en55847, valida identidad exacta y ejecuta seis subpruebas más el contenedor:7 aprobadas. Comprueba ambos dueños, responsable, colaborador, persona ajena, renombre y homónimos; lecturas sin actor e IDs inválidos; workspace ausente o distinto, papelera y archivo con booleanos y strings; eliminación de tarea conservando la pieza; CAS y permiso previamente leído tras quitar una asignación. Los snapshots de siete tablas prueban que las lecturas y los rechazos no cambian negocio. No se generó publicación manual.

La suite existente render2-goals-content.integration.test.js renovó10 comprobaciones: preparación observada, dueños competidores, acceso por ID, cambios de nombres, contenido/CAS, invalidación de aprobación, colaboradores y ediciones concurrentes. Ambas suites terminaron0, sin fallos ni omisiones; sus hooks comprobaron limpieza de cada raíz temporal mediante ENOENT. La primera suite se repitió tras ampliar casos; no se suma esa repetición al total17.

Regresión frontend2472 aprobadas; backend1982 aprobadas y124 integraciones optativas omitidas; cero fallos. Build index-DMPN57gt.js correcto y diff-check limpio. Logs en `/private/tmp/render2-goal187-frontend.log`, `/private/tmp/render2-goal187-backend.log`, `/private/tmp/render2-goal187-build.log`, `/private/tmp/render2-goal187-capability-final.log` y `/private/tmp/render2-goal187-content-regression.log`.

## Navegador y entorno interrumpido

La nueva sesión del navegador integrado no consiguió adjuntar una pestaña usando las dos alternativas documentadas. No hay validación nativa ni captura nueva de esta condición del botón. La falla de Atrás descrita en GOAL_PIECE_DRAFT_QA.md sigue sin causa nativa confirmada y sin corregir; no se cambió el kernel ni se compensó el historial.

El fixture anterior reiniciado para investigar Atrás quedó sin coordinador tras una interrupción. Se comprobó que el PID69096 ya no existía; el postmaster69109 sí pertenecía exactamente a `/private/tmp/render2-local-F3XurX/data`, loopback55846. Se detuvo solo ese clúster, se comprobó ausencia de listener52811 y de postmaster.pid y se eliminó exclusivamente esa raíz sintética con ENOENT final. No se presenta esa limpieza manual como una comprobación de snapshots del recorrido interrumpido. No se tocaron bases configuradas, servicios activos ajenos ni producción.

## Autoridad de escritura corregida en desarrollo

Estado vigente: S187 01 fue corregido y verificado posteriormente en GOAL_CONTENT_AUTHORITY_QA.md. Los párrafos siguientes conservan el hallazgo original y el contrato que guio la corrección; no representan un pendiente reabierto ni una corrección atribuida al permiso visual.

Hallazgo S187 01, Medium/P2, relacionado con REACT AUTHZ 001: editGoalContent toma ID y rol observados por middleware, pero su transacción solo bloquea la tarea. No retiene ni vuelve a verificar la fila del usuario antes de escribir. Evidencia en backend/src/client-goals.js, función editGoalContent, y backend/src/auth.js, requireCurrentIdentity. Una revocación, desactivación o cambio de rol confirmado entre ambas observaciones podría dejar una escritura usando autoridad anterior. Es un hallazgo por fuente; no se ejecutó esa carrera en este corte ni se probó acceso anónimo o financiero.

El contrato de corrección exige capturar actor, retener una lectura bloqueada de usuario antes de los locks de dominio y verificar activo, rol y versión de sesión en la misma transacción. Las barreras PostgreSQL deben acreditar que revocación confirmada primero rechaza sin DML y escritor autorizado primero puede terminar antes de que la revocación obtenga el bloqueo. La implementación y comprobación posterior pertenecen al cierre transaccional citado, no al permiso de presentación de este informe.

Render2 sigue implementado solo en desarrollo local, con aceptación global y despliegue pendientes. No hubo push, despliegue ni cambios de producción.
