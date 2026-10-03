# Supervisor operativo de Mía

## Alcance y reglas

Solo supervisa tareas activas de RENDER OS, no listas personales ni Finanzas.
Todos los responsables tienen igual peso. Los permisos salen del usuario
vinculado a WhatsApp en PostgreSQL, nunca del nombre enviado por el asistente.
Agustín y Franco socio pueden compartir la cuenta `lider` con dos identidades
y destinos distintos. Franco Romero/Chovy no es líder por llamarse Franco.

Horario de seguimiento: lunes a sábado 08:00–13:00 y 17:00–21:30,
America/Argentina/Buenos_Aires. Domingo no se envía seguimiento. Las respuestas
privadas se pueden registrar fuera de esas franjas.

- Sin fecha: propone un plazo según carga, complejidad y dependencias, lo deja
  en comentarios y pide acuerdo. No carga una fecha sin aceptación.
- Vencida: una pregunta sobre estado. Luego solo pregunta el dato faltante.
  Respuestas parciales quedan guardadas; no inventa motivos ni fechas.
  Cualquier conversación real pausa contactos proactivos durante cuatro horas.
- Máximo un contacto proactivo por persona real por franja laboral.
  Reintenta en otra franja, hasta tres entregas efectivas; no a las tres horas.
  No cuenta una reserva o fallo de WhatsApp como intento entregado.
- Agrupa dos tareas compatibles y los hallazgos para líderes. No cuenta un
  intento para tareas que no fueron mencionadas en el mensaje agrupado.
  Diez minutos de cooldown global entre avisos privados de distintos módulos,
  verificado también en VPS por destino real (no por alias).
- Si no hay respuesta, escala en privado a ambos líderes. Si hay un bloqueo,
  contacta al usuario indicado o a los responsables de la tarea dependiente.
- No elimina tareas, no publica cambios de código y no pasa a revisión sin
  los controles de material que ya tiene el sistema.
- Las confirmaciones no vencen por tiempo; una propuesta sustituida, datos
  cambiados o una fecha pasada requieren revisar el acuerdo.

## API firmada y cliente

Base: `/api/integraciones/wilson`. Firma RSA v2 existente de Mía, con actor,
grupo, nombre, método, ruta y cuerpo. No poner claves en Git.

| Operación | Endpoint | CLI Python |
|---|---|---|
| Simular control (solo SELECT) | POST /supervisor/tick `{"dry_run":true}` | supervisor-tick |
| Aplicar control | POST /supervisor/tick `{"dry_run":false}` | supervisor-tick --apply |
| Leer contexto permitido | GET /supervisor/contexto | supervisor-context |
| Registrar conversación privada real | POST /supervisor/conversacion | supervisor-inbound |
| Auditoría anonimizada exclusiva del proceso técnico | GET /supervisor/comunicaciones | consulta firmada |
| Acordar fecha | POST /supervisor/tareas/:id/fecha | supervisor-accept-date |
| Registrar avance | POST /supervisor/tareas/:id/respuesta | supervisor-reply |
| Responder bloqueo solicitado | POST /supervisor/tareas/:id/bloqueo | supervisor-blocker-reply |

El control global solo acepta el actor técnico `WILSON_SYSTEM_ACTOR_ID`.
Las respuestas y contexto requieren chat privado de un empleado vinculado.
Usar siempre el ID del mensaje de transporte como `message_id`: replays con
el mismo contenido son idempotentes, otro contenido para ese ID devuelve 409.

Ejemplo de respuesta, sin inventar datos ausentes del texto:

```json
{"message_id":"ID_REAL_WHATSAPP","texto":"Estoy editando, faltan las fotos del producto; lo entrego mañana.","estado":"en_progreso","motivo":"faltan las fotos del producto","nueva_fecha":"AAAA-MM-DD","fecha_texto":"mañana"}
```

Estados del reporte: `pendiente`, `en_progreso`, `bloqueada`,
`lista_para_revision`. Este último registra el avance pero conserva el flujo
de revisión habitual. Para bloqueo, `bloqueo_usuario_id` es opcional y debe
referirse a un usuario real. Para aceptar plazo: `proposal_id`, `message_id`
y opcionalmente `fecha` en ISO.

## Publicar y activar sin mensajes de QA

1. Desplegar el commit en Hostinger con `MIA_SUPERVISOR_ENABLED=false` y
   `TASK_COMPLETED_CLEANUP_ENABLED=false`. El arranque normal aplica la
   migraciones 046 y 047 una vez. 047 cancela mensajes antiguos pendientes,
   conserva recibos/historial y prepara los límites y respuestas parciales.
   Confirmar previamente que las migraciones
   históricas —especialmente 044, de limpieza— ya figuran en `_migrations`.
2. Verificar tablas de 046 y las identidades de ambos líderes (sin imprimir
   hashes/credenciales). Revisar roles y WhatsApp habilitado en Usuarios.
3. Actualizar **también el VPS**, no solo Hostinger:
   `backend/scripts/mia_render_os_task.py` al cliente usado por Mía;
   `scripts/mia_event_worker.py` a `/root/.openclaw/workspace/tools/`.
   Respetar la clave privada y el ledger existente. No borrar ni regenerar
   el ledger; retiene envíos inciertos para no duplicarlos.
4. Incorporar `ops/openclaw/AGENTS-SUPERVISOR.md` como instrucciones operativas
   de Mía **sin sustituir** las reglas de identidad/seguridad existentes.
5. Completar `MIA_PRIVATE_RECIPIENTS_JSON` en el archivo de credenciales del
   VPS: `lider_agustin` y `lider_franco` apuntan a los socios. No usar `franco`
   sin vínculo verificado de Chovy; se retiró el alias ambiguo. Mantener destinos
   normales existentes. Backend solo guarda hashes,
   el worker conserva los números fuera de Git.
6. Con la identidad técnica ya configurada, ejecutar `supervisor-tick` sin
   `--apply`. Debe devolver `dry_run:true`, propuestas y señales sin escribir.
   `python3 .../mia_event_worker.py --dry-run` no reserva mensajes ni envía
   WhatsApp. Nunca usar `--send` para QA.
7. Solo después de verificar el dry-run, habilitar
   `MIA_SUPERVISOR_ENABLED=true` en Hostinger y reiniciar/desplegar. El backend
   controla cada cinco minutos y la cola utiliza el timer de eventos existente.
   No hace falta otro cron para generar seguimientos.
8. Razonamiento externo opcional: habilitar aparte
   `MIA_SUPERVISOR_REASONING_ENABLED=true` y `OPENAI_API_KEY` después de
   verificar disponibilidad de `MIA_SUPERVISOR_REASONING_MODEL`. Fallos del
   modelo no impiden las reglas de seguimiento; no tiene herramientas ni
   recibe briefs, secretos o finanzas.

Si no se pudo acceder al VPS, aplicar/verificar migración o ejecutar el
dry-run firmado, el despliegue NO demuestra que el supervisor esté operativo.
Informar cada pendiente, sin afirmar que una variable sola soluciona todo.

## Pruebas y reversión

```sh
cd backend
npm test
# Solo PostgreSQL localhost de QA:
MIA_SUPERVISOR_TEST_DATABASE_URL=postgresql://USER@127.0.0.1:PORT/postgres node --test test/mia-supervisor-db.test.js
cd ..
python3 scripts/test_mia_delivery_guard.py
```

Para detenerlo, poner `MIA_SUPERVISOR_ENABLED=false` y reiniciar backend:
cesan controles y se filtran envíos del supervisor, sin borrar datos ni
detener avisos normales. No revertir la migración ni eliminar historial.

## Corrección de intensidad — 03/10/2026

Auditoría firmada y anonimizada: 262 mensajes del supervisor para ocho destinos;
un destino recibió 76 y el intervalo mínimo observado fue 19,019 segundos.
Había bloques de 366–409 caracteres con estimaciones internas, UUID y varias
peticiones a la vez. La corrección reemplaza ese formato por una pregunta con
título/cliente y fecha DD/MM; guarda los identificadores solo como metadatos.
La pausa se aplicó mediante MIA_SUPERVISOR_ENABLED=false, sin desconectar canales.
