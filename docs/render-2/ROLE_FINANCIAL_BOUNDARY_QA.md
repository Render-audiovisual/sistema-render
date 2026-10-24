# Permisos financieros por rol

Actualización196: COOKIE_ROLE_FINANCIAL_BOUNDARY_QA.md agrega la matriz física por cookie, sueldo/tarifas, acuerdo mensual y revocación, con53 comprobaciones físicas vigentes de su alcance. La matriz bearer y sus resultados históricos descritos debajo no se convierten en pruebas de navegador ni se suman como nuevas ejecuciones.

La matriz local verificó que Diseño, Edición, Producción, Community y Programación pueden consultar los datos operativos probados sin recibir importes financieros privados. Los cinco roles tienen denegadas las rutas financieras y administrativas incluidas en la prueba. Franco QA y Agustín QA conservan acceso a importes genuinos de la base de prueba. No se encontró una fuga nueva en este alcance ni se modificó código del producto.

## Contratos verificados

Todas las rutas de esta tabla tienen prefijo `/api`. Los permisos proceden de identidades autenticadas por el backend, no del nombre visible ni de un selector local.

| Recurso | Cinco roles operativos | Dos cuentas admin QA |
| --- | --- | --- |
| Reportes `/reportes/datos` |200, DTO sin importes; usuarios del reporte limitados al actor |200, incluye el importe histórico de entregas de edición |
| Catálogo `/clientes` |200, cliente y cuotas útiles, sin abono |200, abono vigente visible |
| Operación `/clientes/:id/operacion` |200, proyección operativa sin información económica |El mismo recurso es operativo; no se convierte en pantalla financiera |
| Directorio `/usuarios` |200, identidades públicas activas para asignaciones, sin contactos administrativos, hashes ni épocas de sesión |200, contactos y revisión administrativa permitidos; nunca credenciales |
| Inicio `/inicio` |200, identidad personal correcta, sin importes privados |La matriz no amplía los permisos del inicio personal |
| Sueldos, contratos y pagos |403 en las cuatro lecturas financieras probadas |200 en Sueldos, Contratos, contexto de pagos y ledger con importes de prueba |

Reportes administrativo no es un endpoint libre de importes: conserva `entregasEdicion[].importe` del historial. La privacidad exigida para empleados se verifica en las respuestas del servidor. El directorio público compartido tampoco equivale a acceso de gestión de otros usuarios; los nombres son necesarios para asignar trabajo.

## Matriz física nueva

`backend/test/render2-role-financial-boundary.integration.test.js` usa el harness que genera una base PostgreSQL nueva en55838, verifica identidad/directorio y exige opt-in `RENDER2_RUN_LOCAL_INTEGRATION=true`. No acepta una base configurada ni un directorio existente. Las tres cuentas operativas adicionales se crearon mediante la API administrativa real; hubo siete logins de prueba en total.

El fixture contiene importes distintos para abono, contrato, gasto, pago manual y entrega histórica de edición. Los controles positivos confirman que esos valores existen y llegan a los administradores; no se trata de ocultar una base vacía. Los canarios están en campos económicos estructurados, no en títulos públicos de clientes o tareas.

Cada rol operativo hizo cinco lecturas: Reportes, Clientes, Operación de cliente, Usuarios e Inicio. Las25 respuestas conservaron datos útiles donde corresponde y rechazaron los campos/importes privados comprobados. Dos administradores realizaron14 lecturas positivas. La proyección pública de usuarios no se fuerza a ser propia: se comprueba que sirve para asignar y no expone datos administrativos.

La matriz negativa cubre15 combinaciones de ruta/método para cada uno de los cinco roles y el anónimo:90 rechazos en total. Incluye GET de Sueldos/Contratos/Pagos/contexto, alta/edición/baja de contrato, registro/anulación de pago, configuración/abono de cliente, creación de cliente/usuario y edición de rol/acceso. Los actores autenticados reciben403; el anónimo401. Los snapshots de todas las tablas públicas permanecen iguales antes y después de cada grupo. Se comparan hashes de los snapshots para que un fallo no imprima credenciales ni hashes de contraseñas.

La versión final pasó13 pruebas, cero fallos u omitidas, incluido el contenedor. Log: `/private/tmp/render2-audit180-role-matrix-final.log`. El ensayo previo, antes de añadir el canario histórico de edición, también pasó13; no se suma dos veces al total vigente. Ambos clústeres terminaron y confirmaron ENOENT de `/private/tmp/render2-local-5Op1rG` y `/private/tmp/render2-local-Ctdwq9`.

## Cohorte renovada y regresión

Estas cuatro suites físicas pasaron27 pruebas, cero fallos u omitidas:

- `render2-report-snapshot.integration.test.js`: pertenencia por ID, evidencia, DTO y coherencia RR read-only, incluidos roles operativos y desconocido.
- `render2-finance-snapshot.integration.test.js`: importes reales de fixture, autorización de ambos administradores y denegación de empleado/anónimo.
- `render2-client-catalog-authority.integration.test.js`: autoridad y abonos en el mismo snapshot.
- `render2-user-catalog-authority.integration.test.js`: datos administrativos/públicos y autoridad en el mismo snapshot.

Log `/private/tmp/render2-audit180-security-cohort.log`; las cuatro limpiezas confirmaron ENOENT de `/private/tmp/render2-local-V57zuy`, `/private/tmp/render2-local-TQwYS9`, `/private/tmp/render2-local-LgOrQt` y `/private/tmp/render2-local-L4NVwi`. La matriz nueva y esta cohorte suman40 pruebas físicas vigentes, no40 recorridos de navegador.

`npm test` backend pasó1982 y omitió122 integraciones opt-in, cero fallos. Log `/private/tmp/render2-audit180-backend.log`. No se repitieron build ni frontend porque no cambiaron sus fuentes. Diff-check pasó.

## Navegador real

En un clúster separado con HTTP52805 y PostgreSQL55839 se prepararon cliente, abono/configuración, contrato y una tarea de Desarrollo ficticios. La sesión cookie de Programación mostró su tarea y cliente en Inicio. Reportes cargó una tarea propia sin mostrar los canarios económicos; la barra lateral no ofreció Finanzas. Abrir directamente `/sueldos` devolvió a Inicio. Esto complementa, pero no reemplaza, las denegaciones de API de la matriz.

A390×844, Reportes no desbordó horizontalmente el documento y no mostró los canarios. Las tablas conservan desplazamiento horizontal interno: no se certifica con ello su facilidad de uso completa. Capturas `/private/tmp/render2-role180-report-development.png` y `/private/tmp/render2-role180-report-development-mobile.png`.

Una comprobación visual inicial quedó interrumpida por una demora del navegador. Se consultó su handle y confirmó terminación con dominio intacto y limpieza antes de crear otro clúster; no se reinició un proceso meramente por timeout de observación. Ambos clústeres visuales confirmaron las ocho tablas de negocio observadas sin cambios y ENOENT de `/private/tmp/render2-local-sO9bJZ` y `/private/tmp/render2-local-JEFrpQ`. Se restauró el viewport y cerraron sus pestañas. Solo se eliminaron datos sintéticos propios.

## Coordinación y límites

Hypatia revisó cobertura y contratos sin editar. Carver añadió la matriz en un archivo independiente. El coordinador revisó el test, protegió sus diagnósticos con hashes, añadió el canario histórico de edición y ejecutó las pruebas y el navegador. Las skills de seguridad, trabajo estructurado y documentación orientaron el alcance y las condiciones de aceptación.

No se probó una publicación en hosting, HTTPS/proxy, Google, aprovisionamiento real de los dueños ni proveedores. La nueva matriz HTTP usa bearer; la comprobación nativa utiliza cookie para Programación, no para los cinco roles a la vez. Las pruebas verifican campos económicos estructurados, no clasificación semántica de cualquier texto libre introducido por usuarios. Continúan pendientes aceptación transversal de todos los endpoints, mayor cobertura cookie por rol y usabilidad poblada de las tablas móviles. Este corte no autoriza despliegue ni declara terminado Render2.
