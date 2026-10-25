# Reportes: alcance compartido sin información económica

Decisión humana explícita, integración369: «Todo el equipo y todos los clientes, sin dinero». Sustituye el alcance propio de Reportes documentado antes de esta integración. No sustituye las reglas de Inicio, tareas directas, administración ni Finanzas.

## Lectura

`GET /api/reportes/datos` comparte tareas, piezas editoriales, clientes/cuotas, identidades operativas, entregas históricas y producciones entre admin, diseño, edición, producción, community y programación. El mes/rango y las reglas existentes de archivo/papelera conservan su semántica. No se filtran filas por nombre, responsable o membresía del lector.

Todas esas cuentas, incluidos los dueños, reciben el mismo DTO operativo cerrado. Se excluyen importes, abonos, costos, sueldos, tarifas, contactos privados, credenciales y bolsas JSON no permitidas; el lector SQL de entregas ya no solicita `importe`. Se conservan cuotas de contenido, que son cantidades operativas, no dinero. Los dueños siguen obteniendo información económica únicamente de sus endpoints autorizados, no de este reporte.

La validación de actor/rol/actividad/época permanece dentro del snapshot PostgreSQL `REPEATABLE READ READ ONLY`. Identidades ausentes/inválidas o retiradas no obtienen el reporte compartido. Los roles personalizados no adquieren acceso de equipo nuevo; su proyección heredada permanece sin ampliación.

## Atribución y autorización

Un ID de usuario identifica la atribución; compartir una fila no asigna su trabajo al lector. Un nombre histórico sin ID no se convierte en identidad ni concede acceso de escritura. Entregas históricas sin editor identificado se muestran sin atribuir y sin importe.

Inicio continúa personal para empleados. Las rutas directas de tareas, aprobación/publicación, gestión de usuarios y Finanzas mantienen sus controles independientes. Leer Reportes no concede aprobación, edición, publicación ni administración.

## Verificación

Tests unitarios de report-access, privacidad, snapshot y crédito de edición; matrices HTTP bearer/cookie de cinco roles y dos dueños; snapshot físico; adopción editorial con homónimos; recorridos audiovisuales completos y aceptación principal. Se conservan pruebas de noDML, revocación, Inicio propio, denegación de escrituras y Finanzas autorizadas. Consultar CURRENT_ACCEPTANCE.md para ejecuciones y límites concretos. No implica despliegue, certificación de dispositivos externos ni filtrado semántico de cualquier dato que alguien escriba dentro de un título libre.
