# Creación recuperable de bloques personales

Integración local384. La fuente operativa sigue siendo PostgreSQL. El intento
en memoria del componente no es almacenamiento comercial ni sobrevive por sí
solo a una recarga; las páginas y los bloques sí persisten en el servidor.

## API principal

- `POST /api/listas-personales/:listId/bloques`: cuerpo cerrado con `request_id`
  UUID, `tipo` y `contenido`. Normalización comercial existente antes del hash.
- Primera confirmación:201. Repetición idéntica:200 y el mismo bloque actual.
- Respuesta: bloque raw habitual más `creation_request_id`, sin hashes ni recibo
  privado expuesto. No se infiere autoría desde nombres.
- `GET /api/listas-personales/:listId/bloques/creaciones/:requestId`: consulta
  explícita `no-store`, sin DML y con ownership/identidad vigente.
- UUID ausente:428; formato/campos inválidos:400. Lista ajena/inexistente:404,
  también para administradores. ID de intento reutilizado con otra lista o
  contenido:409. Bloque eliminado con recibo:409; nunca se recrea.

## Persistencia y concurrencia

093 añade `personal_list_block_create_receipts`, vacía, sin backfill. Clave
primaria `(actor_user_id,request_id)`; hash canónico de lista/tipo/contenido;
IDs BIGINT sin redondear. Se conserva la identidad exclusiva del usuario antes
de locks de lista/bloque, igual que las otras escrituras de Mi lista.

Insertar bloque/posición y recibo comparte transacción READ COMMITTED. El límite
80 se aplica a nuevas creaciones, no impide recuperar una creación existente.
Un replay compara hash original y lee el bloque actual, no restaura contenido
antiguo. El recibo es inmutable; no tiene FK de lista/bloque para conservar el
tombstone al eliminarlos. El FK del actor es RESTRICT, como los recibos de página.
GET revalida la sesión y ownership sin reparar ni crear nada. Rollback fallido
descarta la conexión y mantiene el error primario.

## Interfaz

El modelo conserva UUID, cuerpo serializado y lista original durante la vida del
componente/sesión. Un ACK perdido queda pendiente; no admite otro bloque ni un
POST automático. Verificar consulta GET; solo después de404 permite reenviar
explícitamente el mismo cuerpo y UUID. Un rechazo definitivo se cierra por
decisión explícita. Un cambio de sesión retira el intento privado.

La reconciliación agrega por ID a la lista original sin navegar ni sobrescribir
filas locales existentes/ediciones en cola. El guard y el estado de guardado leen
el modelo síncrono, no solo el último render. Recuperación visible en documento,
fallback y página vacía; no se añade un tercer hijo al grid.

## Migración y límites de entrega

Startup exige columnas y binding habilitado del trigger de093; no migra ni repara.
El ensayo pre093 utiliza únicamente un cluster desechable con deferral boolean
explícito, status/plan aprobado y CLI real. Nunca sustituirlo por una base
configurada. La aplicación de093 a un destino existente requiere autorización,
backup/restauración y plan de despliegue; esta integración no los autoriza.

Los consumidores externos/legacy del POST principal deben enviar `request_id`.
El protocolo firmado de MIA usa sus propios tokens y SQL: no llama a ese POST y
no se declara unificado ni modificado por este recibo.

Pruebas de384: modelos/callbacks reales, HTTP cookie/PostgreSQL, ACK descartado
observado tras un POST real, concurrencia, tombstone y ensayo poblado. No equivale
a una pérdida de red nativa, aceptación móvil/Chrome o todos los interleavings.
