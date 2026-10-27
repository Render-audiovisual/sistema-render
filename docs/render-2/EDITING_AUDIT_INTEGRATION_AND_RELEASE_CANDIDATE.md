# Auditoría integrada y candidato de publicación — 27/10/2026

## Estado y alcance

Implementado en desarrollo y verificado en copias/fixtures. No desplegado. No push, cambios de entorno del hosting, migraciones productivas, restauración sobre la base viva ni envíos a WhatsApp/correo reales. Los correos de Agustín y Franco quedan pendientes por decisión explícita del usuario; no se crean identidades ficticias ni se promueve a Franco Romero. La cuenta Líder y sus asignaciones no se reparten.

Main coordina e integra archivos compartidos. Hilbert revisa SQL/preservación y compatibilidad de tests. Meitner prueba HTTP firmado, entregas, notificaciones y mocks transaccionales. Fermat prueba upgrade, constraints y concurrencia. Ningún agente modifica simultáneamente los módulos críticos.

## Integración realizada

- `editing-deliveries.js`: registra crédito operativo dentro de la misma transacción de la entrega real, después del artefacto y antes del COMMIT. Un fallo revierte tarea, entrega y crédito. Replays no crean otra fila.
- `wilson-integration.js`: monta `GET /auditoria-edicion` después de firma v2 e identidad canónica. Solo chat privado de WhatsApp, administrador humano vinculado y vigente. Consulta cerrada/no-store, sin datos de sueldo, importes, URLs de material ni notas privadas.
- `editing-progress-ledger.js`: una fila por tarea; responsable por ID de asignación, no actor ni nombre. Primera atribución y fecha permanecen; revisión, aprobación y finalización se cuentan separadas. Finalizar trabajo no publica piezas.
- Históricos conservan clave, fechas y snapshots con editor-ID/origen nulos. Se consultan por alcance histórico explícito, sin asociarlos silenciosamente a un usuario actual. `editor_id` consulta solo crédito canónico. Actualizar las instrucciones del agente externo: no interpretar la consulta histórica como todos los trabajos nuevos de una persona.
- CLI: `editing-audit --period YYYY-MM [--editor-id ID]`. Período obligatorio, IDs int32, sin inferir usuario9 ni mes actual. No se enviaron solicitudes a proveedores reales.
- Arranque comprueba columnas y binding habilitado de la proyección, función y definición exactas, y ausencia del trigger antiguo. Un esquema incompatible impide escuchar; no hay reparación automática.

## Migración prospectiva

Nombre generado con CLI oficial Supabase2.122.0, en carpeta temporal no enlazada: `20261027144706_editing_progress_unified_ledger.sql`. Se conserva ese nombre en el runner existente de Node; no se crea una segunda historia Supabase ni una baseline. El archivo ordena después de093 y cambia el hash de cualquier plan anterior.

Instalación nueva: ledger vacío. Upgrade: valida estructura/trigger heredados conocidos, añade cuatro columnas nullable y constraints/FK, renombra la unicidad existente y sustituye el trigger por proyección UPDATE-only de filas existentes. No backfill, atribución por nombres, cambio de fechas ni DML salarial.051/052 siguen recognition-only y no se reejecutan. Se conserva la función antigua sin binding y sus ACL; las rutinas nuevas se cierran mediante el protector del runner.

Las transacciones y timeouts son los del runner; cada archivo confirma por separado. No es una migración atómica de toda la cadena. El runtime anterior no puede considerarse rollback compatible después de retirar el trigger antiguo. No hay override productivo ni se falsea production como sandbox.

## Ensayo del respaldo más reciente disponible

Otra restauración nueva del respaldo privado del26/10, no de una copia con tareas de prueba previas. PostgreSQL18.4 local con red saliente bloqueada; fuente respaldada PG17.6.64 tablas/7.732 filas/338 tareas y58 migraciones iniciales. Se aplicaron41 migraciones pendientes: ledger58→99,0 pendientes/desconocidas y esquema principal compatible.

Se conservaron todos los valores y tipos de columnas originales mediante proyección que excluye solo columnas nuevas. Las64 tablas originales mantuvieron conteos/hashes y las filas previas del ledger de migraciones.47 tablas nuevas se protegieron con RLS y sin grants anon/authenticated; los ACL/RLS anteriores a aplicar SQL no cambiaron dentro de esta copia. La restauración usó `--no-privileges`: esto no certifica los permisos efectivos actuales de producción ni una restauración completa de servicios administrados.

HTTP real y luego HTTP desde el artefacto: sesiones cookie/CSRF independientes, empleado sin rutas financieras, Reportes sin claves privadas, tres cierres manuales preservados, tarea creada/asignada por ID, replay, edición de fecha, nueva sesión, persistencia PostgreSQL e Inicio. Los datos originales siguen invariantes, excluyendo únicamente registros sintéticos identificados. No se reescriben tareas reales para probar.

Plan de asignacionesv2 regenerado en esta copia: universo339 =338 tareas originales elegidas +1 excepción sintética explícita ya asignada.338 responsables/12 colaboradores =350 vínculos;62 tareas Líder sin repartir. Solo cambia `tarea_asignaciones`; las otras110 tablas conservan contenido/xmin/ctid. Un replay del apply rechaza sin cambios y el reinicio confirma los vínculos. Este plan no autoriza aplicar sobre la base viva y no se copia a producción.

Copia privada local: `/private/tmp/render2-upgrade-4JITEY`, detenida al finalizar cada etapa; respaldo fuente intacto. Evidencia privada en esa carpeta y logs `/private/tmp/render-editing-fresh-upgrade.log`, `render-editing-final-fresh-http.log`, `render-editing-fresh-assignments.log`. No incorporar dumps, credenciales ni planes con datos privados a Git.

La rutina SECURITY DEFINER identificada en la copia es `public.rls_auto_enable()`, retorna `event_trigger` y fija `search_path=pg_catalog`; su cuerpo habilita RLS en objetos DDL y no consulta tareas/finanzas. No se invocó. No es certificación de ACL vivos ni del event binding administrado, excluido del dump público.

## Candidato nuevo

`/private/tmp/render-editing-final-OdOel5/app`:333 archivos de aplicación y dependencias propias. SHA256 del manifest `4eacd18bdc8b7597658c08cebc99c910caec853883880b85bfd20cf15ba7e920`. Frontend reconstruido, asset `index-MhFIu74X.js`; no cambios visuales ni nueva inspección móvil en esta fase.

El paquete previo `render-editing-release-vdIjZZ` quedó como evidencia intermedia: no incluye el último guard de arranque. No sobrescribir ni publicar ese candidato. El definitivo se prueba desde su servidor/dependencias y también sobre la restauración actualizada. Manifest e inventarios verifican bytes; no son publicación atómica ni un despliegue.

## Resultados finales reproducibles

- Backend completo:2.953 PASS/188 opt-in SKIP/0 FAIL de3.141. `/private/tmp/render-editing-backend-accepted.log`.
- Cohorte física49archivos:419 PASS/0 FAIL/0 SKIP en123,56s. `/private/tmp/render-editing-core-accepted.log`.
- Frontend completo:3.335 PASS/1 opt-in SKIP/0 FAIL de3.336; build correcto. `/private/tmp/render-editing-frontend-final.log`. No nueva certificación visual móvil.
- Arranque físico negativo:6 PASS, incluyendo trigger faltante/deshabilitado, cuerpo modificado, binding con condición falsa y presencia del trigger legado; cada cambio se revierte. Focales de contratos:30 PASS. No se acepta solo la existencia de un nombre.
- Artefacto definitivo:12 controles PASS desde sus propias dependencias/servidor, incluidos entrega/aprobación/auditoría/cierre/corrección firmados, replay y hashes de aplicación/dependencias invariantes. `/private/tmp/render-editing-final-artifact-smoke.log` y `artifact-smoke.json` junto al paquete. Fixture eliminado ENOENT y sin proveedores.
- Artefacto sobre la copia restaurada:11 controles HTTP y todas las filas originales preservadas; procesos detenidos. `/private/tmp/render-editing-final-fresh-http.log`.
- Audit de dependencias runtime del candidato:0 vulnerabilidades conocidas al27/10, no garantía futura. `/private/tmp/render-editing-final-runtime-audit.json`.
- `git diff --check` limpio. No se cuentan los tests omitidos como verificados ni se suman suites solapadas como recorridos independientes.

Las primeras corridas detectaron expectativas de fixtures desactualizadas: dependencia del nuevo schema después de065, responsable faltante en una tarea sintética,110 tablas en vez de109 y proyección intencional del ledger. Se ajustaron los datos/mocks y se añadieron assertions de la fila exacta del ledger, preservando el resto de hashes y los replays. La primera firma GET del smoke privado usaba el hash de objeto vacío; se corrigió al hash del cuerpo ausente requerido por el contrato existente, sin cambiar la verificación de firmas. Un mock de readiness088 se adaptó al nuevo SELECT. Las corridas anteriores fallidas no se presentan como aceptación.

## Condiciones antes de publicar

1. Los correos y logins independientes de dueños permanecen pendientes, no se resuelven con un selector de perfil. No modificar roles/cuentas reales por nombres.
2. Acordar ventana de mantenimiento y drenar todos los escritores: web anterior, WhatsApp/agentes externos, workers y timers. Hostinger tiene autodespliegue habilitado: no push hasta esa coordinación.
3. Renovar preflight y respaldo consistente en esa ventana; pueden existir datos nuevos posteriores al26/10. Generar/aprobar planes nuevos contra la base vigente. Nunca restaurar esta copia sobre la base actual.
4. Preparar/revisar el ejecutor productivo separado para migraciones y asignaciones con destino/TLS/hashes/identidad exactos, comprobaciones de preservación y resolución de commits inciertos. Los CLI actuales siguen rechazando producción; este informe no ofrece un bypass ni autoriza SQL manual para sortearlos.
5. Configurar explícitamente entorno/TLS/cookies y proveedores en hosting; verificar permisos efectivos nuevos y previos. No asumir que la copia reproduce ACL productivos.
6. Aprobar recuperación compatible de código+base y comprobar el artefacto exacto antes de abrir tráfico. No usar runtime antiguo como reversión automática ni reejecutar históricos/seeds.

**Candidato preparado/verificado localmente ≠ listo globalmente para despliegue ≠ publicado.** Lo pendiente no se reduce únicamente a recibir correos.
