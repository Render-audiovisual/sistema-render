# Edición mensual de clientes

## Alcance

Edición separada de cuota y total realizado desde el lápiz de la tarjeta. Solo
los IDs de la cuenta principal y los perfiles Franco/Agustín definidos en el
servidor pueden utilizar los nuevos controles. No se deducen permisos de nombres.
Las rutas anteriores de edición también requieren esa correspondencia.

## Datos y contratos

- GET `/api/clientes/:key/control-mensual?periodo=YYYY-MM`.
- PUT `/api/clientes/:key/cuota-mensual`: período, reels, carruseles,
  `expected_revision`.
- PUT `/api/clientes/:key/contenido-realizado`: período, modo manual/automatic,
  `expected_revision`; cantidades solo para modo manual.
- `key` es `cliente-ID` o `grupo-ID`; cantidades enteras 0–10000.
- Sesión, CSRF, identidad activa y revocación se conservan. Las escrituras
  revalidan autoridad bajo bloqueo y rechazan una revisión obsoleta con 409.
- Correcciones auditadas en `integracion_auditoria`, sin migración ni publicaciones
  ficticias. El último registro automático elimina el efecto de la corrección,
  pero no borra su historia. Membresía de grupos validada por IDs completos.
- Clientes y reportes individuales usan la misma corrección. Los registros,
  métricas y portadas de Meta siguen sincronizándose sin alterarse.
- Un total mensual no permite inventar su distribución semanal: los informes
  semanales siguen contando las publicaciones individuales existentes.

## Cuotas y finanzas

La cuota es la habitual del cliente/grupo en el modelo existente. Si existe
configuración efectiva para el mes elegido, se guarda una versión mensual
copiando los datos no editados; sin configuración, se actualiza la cuota base
sin fabricar un contrato financiero. Los grupos conservan su cuota compartida
general. No se modifica el abono ni se programa un cambio de precio.

## Verificación local

- Pruebas HTTP con cookies reales y PostgreSQL temporal: principal y perfiles,
  empleado y administrador no mapeado, CSRF, validación, conflicto concurrente,
  corrección persistente, restablecimiento, grupos y clientes sin configuración.
- Huellas de tareas, asignaciones, publicaciones, abonos y medios de Instagram
  sin cambios durante los controles de cantidades.
- Regresión de sincronización, reportes y galería: ocho pruebas de integración.
- Compilación React/Vite y pruebas de tarjetas/formularios.
- Recorrido visual local con cliente ficticio: guardado, recarga y móvil 375 px.

## Estado

Implementado y verificado en desarrollo. Este documento no acredita despliegue.
No se modificaron cantidades de clientes reales ni datos de producción.
