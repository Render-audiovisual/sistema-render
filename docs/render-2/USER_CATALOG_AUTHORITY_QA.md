# Revisión 149: autoridad del catálogo de usuarios

## Implementación local

`backend/src/user-catalog.js` conserva las proyecciones existentes de GET `/api/usuarios`, pero captura ID, rol y versión de sesión antes de esperar una conexión. Dentro de una transacción PostgreSQL REPEATABLE READ READ ONLY vuelve a comprobar la cuenta activa y la coincidencia exacta de esos datos. Solo entonces consulta los campos permitidos, confirma y responde. Una observación revocada devuelve 401 antes de consultar el catálogo. El endpoint incorpora Cache-Control no-store.

Los administradores conservan correo de notificaciones, vínculo Google, indicador de WhatsApp y revisión administrativa; no reciben hashes, tokens ni versión de sesión. Las demás cuentas conservan el directorio operativo activo, necesario para asignar responsables, sin esos campos privados. Esto no concede acceso a administración de otras cuentas ni cambia permisos de escritura. Las revocaciones posteriores al primer snapshot no invalidan retrospectivamente esa lectura consistente; la siguiente petición se rechaza.

No hubo cambios de esquema, migraciones nuevas, dependencias, interfaz, credenciales ni bases configuradas. No se accedió a producción ni se publicó nada.

## Coordinación y archivos

- Integrador: helper, ruta en server.js y actualización de una comprobación heredada de Clientes en finance-calculation.test.js.
- Hypatia: user-catalog.test.js, 16 casos unitarios.
- Poincare: render2-user-catalog-authority.integration.test.js, fixture físico aislado.
- Beauvoir: revisión independiente favorable de autoridad, paridad y limpieza, sin cambios.
- Carver: workspace-production-link.test.js; corrige cuatro expectativas heredadas que omitían el día del calendario y prueba la restauración real de día, mes y visita. Producto sin cambios en Producciones.

El integrador fue el único editor de server.js. Se preservaron fuentes preview/sandbox y archivos no versionados heredados.

## Evidencia

- `node --test test/user-catalog.test.js`: 16/16 aprobadas.
- `RENDER2_RUN_LOCAL_INTEGRATION=true node --test test/render2-user-catalog-authority.integration.test.js`: 7/7 aprobadas, sin omisiones. PostgreSQL nuevo en 127.0.0.1:55799, identidad verificada antes de uso, cuentas sintéticas, red externa deshabilitada por harness. Prueba HTTP real de proyecciones y no-store; barreras reales antes/después del primer SELECT; revocación de rol, epoch e inactivación; captura prelease; hashes de tablas para comprobar ausencia de escrituras del catálogo. No se fabricaron respuestas de autoridad.
- Cleanup ENOENT confirmado para `/private/tmp/render2-local-eqpHNI`.
- Suite backend final `npm test`: 1.993 casos, 1.880 aprobados, cero fallos, 113 omitidos por sus gates de integración. No equivale a correr todas las integraciones físicas.
- `node --check` de helper/server y `git diff --check` aprobados.
- Logs locales temporales: `/private/tmp/render2-user149-unit.log`, `/private/tmp/render2-user149-physical.log`, `/private/tmp/render2-user149-final-backend.log`.

La primera corrida general detectó cinco pruebas desactualizadas, no cinco defectos nuevos del producto: una buscaba una proyección de Clientes ya extraída a su snapshot en 147; cuatro omitían el contrato de día del calendario. Se alinearon con los componentes actuales manteniendo comprobaciones de autorización, URL, respuestas tardías y ausencia de un segundo diálogo. No se ocultaron fallos con skips nuevos.

## Pendientes del rescate

POST `/estructura` aún necesita revalidación de autoridad bajo bloqueo transaccional antes de modificar datos. Siguen pendientes manejo de fallo de tareas vinculadas en Publicaciones, restauración de algunos filtros/contextos y diálogos de listas personales, además de los gates globales de integración/diseño/QA. Esta revisión no prueba todos los endpoints ni todos los recorridos del prompt maestro. No requiere prueba visual nueva porque no modifica UI; tampoco acredita validación móvil nueva.

Estado: implementado y probado localmente; sin despliegue. El objetivo global continúa abierto.
