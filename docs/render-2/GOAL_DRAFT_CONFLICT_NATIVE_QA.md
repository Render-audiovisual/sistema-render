# Recuperación de borrador: conflicto y permisos

## Alcance y resultado

Corte191, exclusivamente local. El navegador real conectado a Express y PostgreSQL conservó el borrador de Luciano frente a una edición del dueño y a la retirada y devolución de su asignación. No se modificó código de producto ni se desplegó nada.

Volta revisó en paralelo los contratos de recuperación, CAS y permisos sin modificar archivos. El coordinador ejecutó el recorrido nativo y las comprobaciones de integridad.

## Recorrido comprobado

1. Luciano abrió una pieza, escribió `QA191 borrador original de Luciano` y volvió a Inicio sin guardar.
2. El fixture realizó una edición autorizada del dueño. Retomar conservó el texto de Luciano, mostró el contenido más reciente del servidor y advirtió del cambio. Guardar produjo conflicto, sin sobrescribir el trabajo del dueño. La primera ejecución registró HTTP409; la ejecución final comprobó el mensaje de conflicto y el contenido conservado sin repetir la instrumentación Network.
3. El fixture reasignó la tarea a Designer. Retomar consultó los permisos actuales: cero editores abiertos y aviso de recuperación conservado. Un segundo intento mantuvo la misma URL y el borrador; no se midió la longitud del historial nativamente.
4. El fixture devolvió la asignación a Luciano. Retomar desde la misma URL abrió su texto original. Guardar siguió rechazando la versión antigua: recuperar permiso no rebasa silenciosamente la revisión de edición.

## Integridad y limpieza

La corrida final terminó0: una edición del dueño, dos reasignaciones, revisión final5, copy final del dueño y responsable Luciano. Antes de cada mutación intencional se compararon nueve tablas con el snapshot anterior; después de los intentos del navegador no hubo cambios adicionales. Tablas: clientes, cliente_configuraciones, tareas, tarea_asignaciones, publicaciones, historias, cliente_objetivos_mensuales, cliente_objetivo_piezas y cliente_objetivo_eventos. Las escrituras de autenticación quedan fuera de ese snapshot comercial.

El clúster temporal `/private/tmp/render2-local-Mx7HCi` se eliminó y se verificó su ausencia. Se cerró únicamente la pestaña de prueba. No se utilizaron bases configuradas ni datos existentes.

La primera ejecución detectó un error del fixture: la reasignación omitía expected_updated_at y el servidor rechazó correctamente con400. Se corrigió el payload de prueba y se repitió desde un clúster nuevo. Esa primera corrida no se cuenta como aprobada; también limpió su raíz `/private/tmp/render2-local-JZRbO2`.

## Reproducción y evidencias

Se conserva `backend/scripts/render2-goal-draft-recovery-qa.js`, con opt-in RENDER2_RUN_LOCAL_INTEGRATION=true, identidad de base verificada y limpieza del harness. Desde backend: `RENDER2_RUN_LOCAL_INTEGRATION=true node scripts/render2-goal-draft-recovery-qa.js`. Esperar ready y comprobar el PID y script exactos antes de enviar señales: SIGUSR1 aplica la edición ajena; SIGUSR2 retira y luego restaura asignación; SIGTERM verifica y limpia. Las acciones de navegador deben intercalarse según el recorrido anterior. No es una prueba automatizada de navegador.

La corrida nativa utilizó el runner temporal equivalente `/private/tmp/render2-goal191-native.mjs`. La versión guardada en repositorio pasó node --check y diff-check, pero no se volvió a ejecutar íntegramente. No se renovaron las suites globales ni el build: los resultados del corte190 mantienen su fecha y alcance.

Capturas: `/private/tmp/render2-goal191-conflict.png` corresponde al primer409; `/private/tmp/render2-goal191-permission-denied.png` y `/private/tmp/render2-goal191-permission-restored.png` corresponden a la corrida final.

## Límites

Quedan pendientes ACK perdido en navegador real, rutas heredadas que desmonten el provider, otros formularios y la aceptación global. Este recorrido no acredita supervivencia a recarga aceptada ni persistencia comercial del borrador: sigue siendo memoria temporal de la pestaña.
