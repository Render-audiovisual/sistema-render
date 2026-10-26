# Ensayo de actualización sobre otra copia — 2026-10-26

## Alcance y aislamiento

Autorización: probar la actualización y corregir lo necesario en otra copia, sin tocar producción ni perder tareas/datos. Se restaura de nuevo el archivo `database-public.dump` verificado del respaldo manual. No se utiliza ni altera el cluster de restauración previamente aceptado. No conexión productiva, despliegue, push, semillas comerciales ni proveedores durante este ensayo.

Copia privada: `/private/tmp/render2-upgrade-LZZ5OA`, PostgreSQL18.4 propio, base `render2_upgrade_test`, loopback55998. Marcador y `data_directory` verificados antes de operar. El servidor PostgreSQL no puede salir a red ni escribir fuera de sus rutas propias. El backend de prueba solo puede conectarse al puerto local55998 y escribir en storage de esa copia; entorno limpio, sin `.env` ni credenciales externas, jobs desactivados. Puerto HTTP55997. Ambos procesos propios detenidos y PID PostgreSQL ausente al cerrar las pruebas. Las evidencias privadas contienen datos sensibles y permanecen fuera de Git.

Entrada inmutable: dump public SHA256 `05f84330cccf71faf2a325ef2171a283033c7236c289c1e99bfb2801d0b33d6f`. El respaldo y la fuente activa no se reemplazan con esta copia.

## Compatibilidad del historial

El ledger restaurado contiene58 migraciones aplicadas, incluidas cinco exclusivas de la rama publicada `hostinger-deploy` en43f02707e299293c5b0c2bb6f12386bd4642746b. La rama de desarrollo las consideraba desconocidas y bloqueaba el arranque.

`backend/src/deployed-migration-history.js` reconoce únicamente esos cinco nombres exactos, documentando SHA de la fuente publicada. `migrations.js` los excluye de `unknownApplied`, pero NO incorpora esos SQL al catálogo ejecutable, NO los vuelve pendientes, NO reescribe ledger ni inventa un baseline. Contienen DML histórico financiero/operativo que no debe repetirse ni cargarse en fixtures nuevos. Los hashes documentan procedencia, no prueban los bytes ejecutados por el ledger antiguo, que carece de hashes. Otros nombres desconocidos siguen bloqueados; la prohibición de migración productiva sigue intacta.

## Migración real y preservación

Plan explícito sandbox, identidad exacta y hashes revisados:40 migraciones054–093. Runner normal con advisory lock, transacciones por archivo y límites de tiempo. No se ejecuta la cadena histórica000–053.

- 64 tablas originales y7.566 filas originales conservadas por conteo y hash de su contenido original;338 tareas conservadas.
- Columnas originales presentes y con tipos iguales; columnas nuevas se separan al comparar hashes.
- 58 filas originales del ledger conservadas;40 incorporadas legítimamente:98 aplicadas,0 pendientes,0 desconocidas.
- 47 tablas nuevas; inicialmente todas vacías excepto una fila técnica en `task_board_order`.
- `assertCoreSchemaReady` correcto. No asignaciones inferidas, visitas inventadas ni aprobaciones/publicaciones automáticas.

Esto comprueba contenido lógico, no igualdad física xmin/ctid. PostgreSQL18 local no certifica roles/ACL/Supabase Auth/Storage del entorno17 productivo. No es una prueba de todos los triggers ni de archivos externos.

## HTTP real sobre la copia actualizada

Backend canónico, sin migración automática. Dos cuentas sintéticas por ID independiente, sin modificar usuarios originales. Comprobaciones terminal0:

- Arranque con ledger98 y esquema actualizado.
- Login real por cookie/CSRF para dueño y empleado.
- Empleado rechazado en Sueldos y contexto de pagos.
- Reportes operativo200 y recorrido recursivo sin las claves privadas comprobadas: abono_mensual, sueldo, sueldo_base, password_hash, ingresos, egresos, importe, monto. Este escaneo acotado no sustituye la cohorte financiera específica.
- Creación201 de tarea con responsable por ID; replay del mismo UUID200 y mismo ID, sin duplicación.
- Lectura autorizada del empleado y aparición en su Inicio personal.
- Edición de fecha por PATCH/CAS, nueva sesión y nueva lectura conservan la fecha; consulta PostgreSQL confirma el valor.
- Tras operaciones, los hashes de todos los registros originales siguen iguales. Se excluyen exclusivamente usuarios/tareas sintéticos y notificaciones de esas tareas, no registros comerciales.

Los primeros intentos no se aceptaron como verdes: se corrigieron permisos demasiado restrictivos del harness y contratos de ruta/consulta del propio ensayo. Las notificaciones legítimas de las tareas sintéticas se separaron del conjunto original para su comparación. No hubo modificación de producto para ocultar esos errores. Los datos de prueba quedan solo en esta copia privada detenida.

Evidencia: `baseline.private.json`, `approved-upgrade-plan.json`, `upgrade-preservation.private.json`, `http-smoke-result.json` dentro del directorio privado. Helpers de esta ejecución en `/private/tmp/render-upgrade-{rehearsal,apply,http-smoke}.mjs`; no son herramientas generales de despliegue y no aceptan un destino productivo.

## Correcciones adicionales y equipo

Coordinador: aislamiento, reconocimiento de historial, ejecución real y comparación. Hilbert: auditoría de migraciones, seis regresiones del reconocimiento y revisión independiente de los artefactos. Harvey: auditoría de32 commits publicados, listener de error del pool y siete pruebas; después actualiza dos contratos de tests que aún exigían Drive/Moodboards retirados. No edición simultánea de server.js/App.jsx.

`db.js` incorpora listener de errores de conexiones ociosas del pool: evita un evento no manejado sin reintentar escrituras ni imprimir conexión/credenciales. Tests de retiro confirman ausencia de menú/montaje y alias conservados, sin borrar APIs, archivos ni almacenamiento histórico.

Las guías Superpowers y Supabase/PostgreSQL orientaron la secuencia por contratos, aislamiento y transacciones cortas; no se usaron para habilitar producción.

## Gates pendientes antes de publicar

Regresión renovada: backend2.705PASS/178opt-inSKIP/0FAIL de2.883; cohorte integrada completa39archivos/358PASS/0FAIL/0SKIP,92,51s, PostgreSQL descartable con limpieza propia. Incluye edición/correcciones/aprobación, tres videos individuales, límites financieros por cookie, objetivos/publicación, proyectos y persistencia. No usa el respaldo como fixture de estas pruebas; son recorridos sintéticos separados. Frontend completo mediante `node --test`:3.328PASS/1opt-inSKIP/0FAIL de3.329. Build frontend correcto, artefacto `index-B1UabfNq.js`. Logs locales: `/private/tmp/render-upgrade-backend-tests-final.log`, `render-upgrade-core-final.log`, `render-upgrade-frontend-complete-final.log`, `render-upgrade-frontend-build.log`. Estos resultados no resuelven la compatibilidad de los registros históricos descrita abajo. No prueba visual nativa nueva en esta ejecución.

1. Las338 tareas históricas conservan asignados textuales, sin asignaciones normalizadas. El Inicio personal por ID no puede deducir legítimamente a quién pertenecen. Hace falta vinculación revisada de identidades reales, no backfill por nombre ni selector local como autenticación.
2. Los cierres históricos manuales de Reportes existen en la copia, pero la proyección/pantalla canónica no los presenta. Preservar su significado como evidencia histórica separada; no inventar tareas completadas o publicaciones.
3. Reconciliar las diferencias funcionales publicadas de Wilson/WhatsApp y edición desde visitas parciales con el contrato actual por video, sin traer transiciones antiguas que publicaban automáticamente.
4. Verificar cuentas independientes reales, permisos/ACL de destino, adjuntos y proveedores. El smoke no certifica esos servicios ni dos dispositivos reales.
5. Preparar procedimiento de migración productiva explícitamente autorizado, plan fresco contra su identidad, ventana y recuperación. El CLI de desarrollo continúa rechazando producción. No sustituir la base viva por este snapshot: perdería cambios posteriores al respaldo.
6. Publicar solo un artefacto coordinado después de resolver los gates y verificarlo. No se publicó nada en este ensayo.

Estado: **implementado y parcialmente verificado en desarrollo aislado; no preparado globalmente ni desplegado en producción**.
