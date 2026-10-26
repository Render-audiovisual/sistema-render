#!/usr/bin/env python3
"""Cliente firmado de Mia/Wilson para RENDER OS.

No interpreta mensajes ni decide permisos: únicamente envía una operación ya
previsualizada y confirmada al backend. La identidad, el grupo y el cuerpo
quedan incluidos en la firma v2.
"""

import argparse
import base64
import hashlib
import json
import os
import pathlib
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid


DEFAULT_BASE_URL = "https://sistema.rendercorrientes.com/api/integraciones/wilson"
DEFAULT_KEY_PATH = pathlib.Path.home() / ".openclaw" / "credentials" / "render_os_private.pem"


def canonical_json(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def identity(args):
    actor_id = args.actor_id or os.environ.get("MIA_WHATSAPP_ACTOR_ID", "")
    actor_name = args.actor_name or os.environ.get("MIA_WHATSAPP_ACTOR_NAME", "")
    group_id = args.group_id or os.environ.get("MIA_WHATSAPP_GROUP_ID", "")
    if not actor_id or not actor_name:
        raise RuntimeError("Faltan actor o nombre de WhatsApp para firmar la operación.")
    return actor_id, actor_name, group_id


def sign_request(method, path, payload, *, actor_id, actor_name, group_id):
    key_path = pathlib.Path(os.environ.get("RENDER_OS_PRIVATE_KEY_PATH", DEFAULT_KEY_PATH))
    if not key_path.exists():
        raise RuntimeError("Falta la clave privada de RENDER OS para Mia.")
    timestamp = str(int(time.time()))
    nonce = str(uuid.uuid4())
    body = "" if payload is None else canonical_json(payload)
    body_hash = hashlib.sha256(body.encode("utf-8")).hexdigest()
    message = "\n".join((
        "v2", timestamp, nonce, "whatsapp", actor_id, group_id, actor_name,
        method.upper(), path, body_hash,
    ))
    signed = subprocess.run(
        ["openssl", "dgst", "-sha256", "-sign", str(key_path)],
        input=message.encode("utf-8"), capture_output=True, check=True,
    ).stdout
    return timestamp, nonce, base64.b64encode(signed).decode("ascii"), body


def request(method, path, args, *, payload=None, idempotency_key=None):
    actor_id, actor_name, group_id = identity(args)
    base_url = os.environ.get("RENDER_OS_API_URL", DEFAULT_BASE_URL).rstrip("/")
    signature_path = f"{urllib.parse.urlparse(base_url).path}{path}"
    timestamp, nonce, signature, body = sign_request(
        method, signature_path, payload, actor_id=actor_id, actor_name=actor_name, group_id=group_id,
    )
    headers = {
        "Content-Type": "application/json",
        "X-Wilson-Channel": "whatsapp",
        "X-Wilson-Actor-Id": actor_id,
        "X-Wilson-Actor-Name": actor_name,
        "X-Wilson-Group-Id": group_id,
        "X-Wilson-Signature-Version": "2",
        "X-Wilson-Timestamp": timestamp,
        "X-Wilson-Nonce": nonce,
        "X-Wilson-Signature": signature,
    }
    if idempotency_key:
        headers["Idempotency-Key"] = idempotency_key
    data = None if payload is None else body.encode("utf-8")
    req = urllib.request.Request(f"{base_url}{path}", data=data, method=method, headers=headers)
    with urllib.request.urlopen(req, timeout=15) as response:
        return json.load(response)


def operation_payload(extra, confirmation_token):
    return {**(extra or {}), "confirmacion_token": confirmation_token}


def task_operation_payload(payload, key=None, expected_revision=None, *, requires_revision=False):
    if not isinstance(payload, dict):
        raise RuntimeError("El payload de tarea debe ser un objeto JSON.")
    result = dict(payload)
    body_key = result.get("idempotency_key")
    for value in ([body_key] if "idempotency_key" in result else []) + ([key] if key is not None else []):
        if (not isinstance(value, str) or not value.strip() or len(value.strip()) > 200
                or any(ord(char) < 32 or 127 <= ord(char) <= 159 for char in value)):
            raise RuntimeError("idempotency_key debe ser texto no vacío de hasta 200 caracteres, sin controles.")
    if key is not None and body_key is not None and key.strip() != body_key.strip():
        raise RuntimeError("--idempotency-key no coincide con el payload.")
    effective_key = key if key is not None else body_key
    if effective_key is None:
        raise RuntimeError("La operación de tarea requiere idempotency_key.")
    result["idempotency_key"] = effective_key.strip()
    if requires_revision:
        revision = result.get("expected_revision")
        if expected_revision is not None:
            if "expected_revision" in result and (type(revision) is not int or revision != expected_revision):
                raise RuntimeError("--expected-revision no coincide con el payload.")
            revision = expected_revision
        if type(revision) is not int or not 0 < revision <= 2147483647:
            raise RuntimeError("Se requiere expected_revision entero positivo observado en GET o --expected-revision; no se consulta ni genera automáticamente.")
        result["expected_revision"] = revision
    return result


def feedback_payload(payload, key=None, *, editing=False, expected_updated_at=None):
    if not isinstance(payload, dict):
        raise RuntimeError("El payload de feedback debe ser un objeto JSON.")
    result = dict(payload)
    body_key = result.get("idempotency_key")
    for value in ([body_key] if "idempotency_key" in result else []) + ([key] if key is not None else []):
        if not isinstance(value, str) or not value.strip() or len(value.strip()) > 200:
            raise RuntimeError("idempotency_key debe ser texto no vacío de hasta 200 caracteres.")
    if key is not None and body_key is not None and key.strip() != body_key.strip():
        raise RuntimeError("--idempotency-key no coincide con idempotency_key del payload.")
    effective_key = key if key is not None else body_key
    if effective_key is None:
        raise RuntimeError("Feedback requiere --idempotency-key o idempotency_key en el payload.")
    result["idempotency_key"] = effective_key.strip()
    if editing:
        version = result.get("expected_updated_at")
        if expected_updated_at is not None:
            if version is not None and version != expected_updated_at:
                raise RuntimeError("--expected-updated-at no coincide con expected_updated_at del payload.")
            version = expected_updated_at
        if not isinstance(version, str) or not version.strip():
            raise RuntimeError("Editar feedback requiere expected_updated_at observado en el JSON o --expected-updated-at; no se genera automáticamente.")
        result["expected_updated_at"] = version
    return result


def add_identity_arguments(parser):
    parser.add_argument("--actor-id")
    parser.add_argument("--actor-name")
    parser.add_argument("--group-id")


def main():
    parser = argparse.ArgumentParser()
    add_identity_arguments(parser)
    commands = parser.add_subparsers(dest="cmd", required=True)
    listing = commands.add_parser("list")
    listing.add_argument("--limit", type=int, default=50)
    commands.add_parser("report")
    fast_context = commands.add_parser("fast-context")
    fast_context.add_argument("--person")
    personal_list = commands.add_parser("personal-list")
    personal_list.add_argument("--user-id", type=int)
    propose_list = commands.add_parser("propose-list")
    propose_list.add_argument("--operation", required=True, choices=("crear", "editar", "completar", "reabrir", "eliminar", "recordar", "reprogramar_recordatorio", "cancelar_recordatorio"))
    propose_list.add_argument("--payload", required=True)
    propose_list.add_argument("--user-id", type=int)
    confirm_list = commands.add_parser("confirm-list")
    confirm_list.add_argument("--confirmation-token", required=True)
    commands.add_parser("events")
    group_digests = commands.add_parser("group-digests")
    group_digests.add_argument("--dry-run", action="store_true")
    private_notifications = commands.add_parser("private-notifications")
    private_notifications.add_argument("--limit", type=int, default=20)
    private_notifications.add_argument("--dry-run", action="store_true")
    commands.add_parser("supervisor-context")
    supervisor_inbound = commands.add_parser("supervisor-inbound")
    supervisor_inbound.add_argument("--message-id", required=True)
    supervisor_tick = commands.add_parser("supervisor-tick")
    supervisor_tick.add_argument("--apply", action="store_true")
    supervisor_reply = commands.add_parser("supervisor-reply")
    supervisor_reply.add_argument("--task-id", required=True, type=int)
    supervisor_reply.add_argument("--message-id", required=True)
    supervisor_reply.add_argument("--payload", required=True)
    supervisor_blocker = commands.add_parser("supervisor-blocker-reply")
    supervisor_blocker.add_argument("--task-id", required=True, type=int)
    supervisor_blocker.add_argument("--message-id", required=True)
    supervisor_blocker.add_argument("--payload", required=True)
    supervisor_date = commands.add_parser("supervisor-accept-date")
    supervisor_date.add_argument("--task-id", required=True, type=int)
    supervisor_date.add_argument("--message-id", required=True)
    supervisor_date.add_argument("--proposal-id", required=True)
    supervisor_date.add_argument("--date")
    verify_private = commands.add_parser("verify-private-notification")
    verify_private.add_argument("--notification-id", required=True, type=int)
    verify_private.add_argument("--fingerprint", required=True)
    resolve_review = commands.add_parser("resolve-review")
    resolve_review.add_argument("--references", required=True)
    preview_review = commands.add_parser("preview-review")
    preview_review.add_argument("--task-ids", required=True)
    confirm_review = commands.add_parser("confirm-review")
    confirm_review.add_argument("--confirmation-token", required=True)
    resolve_finalization = commands.add_parser("resolve-finalization")
    resolve_finalization.add_argument("--references", required=True)
    preview_finalization = commands.add_parser("preview-finalization")
    preview_finalization.add_argument("--task-ids", required=True)
    confirm_finalization = commands.add_parser("confirm-finalization")
    confirm_finalization.add_argument("--confirmation-token", required=True)
    production_videos = commands.add_parser("production-videos")
    production_videos.add_argument("--visit-id", required=True)
    preview_editing = commands.add_parser("preview-video-editing")
    preview_editing.add_argument("--payload", required=True)
    confirm_editing = commands.add_parser("confirm-video-editing")
    confirm_editing.add_argument("--payload", required=True)
    confirm_editing.add_argument("--confirmation-token", required=True)
    for command in ("preview-production-correction", "correct-production"):
        correction = commands.add_parser(command)
        correction.add_argument("--task-id", required=True, type=int)
        correction.add_argument("--record-id", required=True)
        correction.add_argument("--amount", required=True, type=int)
        correction.add_argument("--expected-revision", required=True, type=int)
        if command == "correct-production":
            correction.add_argument("--confirmation-token", required=True)
    ack_event = commands.add_parser("ack-event")
    ack_event.add_argument("--task-id", required=True, type=int)
    ack_event.add_argument("--event-id", required=True)
    ack_digest = commands.add_parser("ack-group-digest")
    ack_digest.add_argument("--fingerprint", required=True)
    ack_digest.add_argument("--payload", required=True)
    ack_private = commands.add_parser("ack-private-notification")
    ack_private.add_argument("--notification-id", required=True, type=int)
    ack_private.add_argument("--fingerprint", required=True)
    get_task = commands.add_parser("get")
    get_task.add_argument("--task-id", required=True, type=int)
    get_task.add_argument("--include-archived", action="store_true", help="Lectura de papelera solo para admin.")
    get_feedback = commands.add_parser("get-feedback")
    get_feedback.add_argument("--feedback-id", required=True, type=int)
    validate = commands.add_parser("validate")
    validate.add_argument("--payload", required=True)
    validate_feedback = commands.add_parser("validate-feedback")
    validate_feedback.add_argument("--payload", required=True)
    propose = commands.add_parser("propose")
    propose.add_argument("--operation", required=True, choices=("crear", "editar", "archivar", "eliminar", "confirmar_grabacion", "crear_feedback", "editar_feedback"))
    propose.add_argument("--task-id", type=int)
    propose.add_argument("--payload", default="{}")
    propose.add_argument("--idempotency-key")
    propose.add_argument("--expected-revision", type=int)
    create = commands.add_parser("create")
    create.add_argument("--payload", required=True)
    create.add_argument("--confirmation-token", required=True)
    create.add_argument("--idempotency-key", required=True)
    create_feedback = commands.add_parser("create-feedback")
    create_feedback.add_argument("--payload", required=True)
    create_feedback.add_argument("--confirmation-token", required=True)
    create_feedback.add_argument("--idempotency-key", required=True)
    update_feedback = commands.add_parser("update-feedback")
    update_feedback.add_argument("--feedback-id", required=True, type=int)
    update_feedback.add_argument("--payload", required=True)
    update_feedback.add_argument("--confirmation-token", required=True)
    update_feedback.add_argument("--idempotency-key", required=True)
    update_feedback.add_argument("--expected-updated-at")
    update = commands.add_parser("update")
    update.add_argument("--task-id", required=True, type=int)
    update.add_argument("--payload", required=True)
    update.add_argument("--confirmation-token", required=True)
    update.add_argument("--idempotency-key", required=True)
    update.add_argument("--expected-revision", type=int)
    archive = commands.add_parser("archive")
    archive.add_argument("--task-id", required=True, type=int)
    archive.add_argument("--idempotency-key", required=True)
    archive.add_argument("--confirmation-token", required=True)
    archive.add_argument("--expected-revision", type=int)
    archive.add_argument("--payload", default="{}")
    delete = commands.add_parser("delete")
    delete.add_argument("--task-id", required=True, type=int)
    delete.add_argument("--confirmation-token", required=True)
    delete.add_argument("--idempotency-key", required=True)
    delete.add_argument("--expected-revision", type=int)
    delete.add_argument("--payload", default="{}")
    confirm_production = commands.add_parser("confirm-production")
    confirm_production.add_argument("--task-id", required=True, type=int)
    confirm_production.add_argument("--expected-revision", required=True, type=int)
    confirm_production.add_argument("--confirmation-token", required=True)

    args = parser.parse_args()
    if args.cmd == "list":
        result = request("GET", f"/tareas?limit={max(1, min(args.limit, 100))}", args)
    elif args.cmd == "report":
        result = request("GET", "/reporte-personal", args)
    elif args.cmd == "fast-context":
        query = "" if not args.person else "?" + urllib.parse.urlencode({"persona": args.person})
        result = request("GET", f"/contexto-rapido{query}", args)
    elif args.cmd == "personal-list":
        query = "" if not args.user_id else "?" + urllib.parse.urlencode({"usuario_id": args.user_id})
        result = request("GET", f"/lista-personal{query}", args)
    elif args.cmd == "propose-list":
        result = request("POST", "/lista-personal/propuestas", args, payload={
            "operacion": args.operation, "usuario_id": args.user_id,
            "payload": json.loads(args.payload),
        })
    elif args.cmd == "confirm-list":
        result = request("POST", "/lista-personal/confirmar", args, payload={"confirmacion_token": args.confirmation_token})
    elif args.cmd == "events":
        result = request("GET", "/eventos-pendientes", args)
    elif args.cmd == "group-digests":
        result = request("GET", "/resumenes-grupos" + ("?dry_run=true" if args.dry_run else ""), args)
    elif args.cmd == "private-notifications":
        result = request("GET", f"/notificaciones-privadas?limit={max(1, min(args.limit, 50))}" + ("&dry_run=true" if args.dry_run else ""), args)
    elif args.cmd == "supervisor-context":
        result = request("GET", "/supervisor/contexto", args)
    elif args.cmd == "supervisor-inbound":
        result = request("POST", "/supervisor/conversacion", args, payload={"message_id": args.message_id})
    elif args.cmd == "supervisor-tick":
        result = request("POST", "/supervisor/tick", args, payload={"dry_run": not args.apply})
    elif args.cmd == "supervisor-reply":
        result = request("POST", f"/supervisor/tareas/{args.task_id}/respuesta", args, payload={**json.loads(args.payload), "message_id": args.message_id})
    elif args.cmd == "supervisor-blocker-reply":
        result = request("POST", f"/supervisor/tareas/{args.task_id}/bloqueo", args, payload={**json.loads(args.payload), "message_id": args.message_id})
    elif args.cmd == "supervisor-accept-date":
        result = request("POST", f"/supervisor/tareas/{args.task_id}/fecha", args, payload={"message_id": args.message_id, "proposal_id": args.proposal_id, "fecha": args.date})
    elif args.cmd == "verify-private-notification":
        query = urllib.parse.urlencode({"fingerprint": args.fingerprint})
        result = request("GET", f"/notificaciones-privadas/{args.notification_id}/verificar?{query}", args)
    elif args.cmd == "resolve-review":
        result = request("POST", "/tareas/resolver-revision", args, payload={"referencias": json.loads(args.references)})
    elif args.cmd == "preview-review":
        result = request("POST", "/lotes/revision/previsualizar", args, payload={"task_ids": json.loads(args.task_ids)})
    elif args.cmd == "confirm-review":
        result = request("POST", "/lotes/revision/confirmar", args, payload={"confirmacion_token": args.confirmation_token})
    elif args.cmd == "resolve-finalization":
        result = request("POST", "/tareas/resolver-finalizacion", args, payload={"referencias": json.loads(args.references)})
    elif args.cmd == "preview-finalization":
        result = request("POST", "/lotes/finalizacion/previsualizar", args, payload={"task_ids": json.loads(args.task_ids)})
    elif args.cmd == "confirm-finalization":
        result = request("POST", "/lotes/finalizacion/confirmar", args, payload={"confirmacion_token": args.confirmation_token})
    elif args.cmd == "production-videos":
        try:
            visit_id = str(uuid.UUID(args.visit_id))
        except (ValueError, AttributeError):
            raise RuntimeError("La visita requiere un UUID canónico válido.")
        result = request("GET", f"/produccion/visitas/{visit_id}/videos", args)
    elif args.cmd == "preview-video-editing":
        result = request("POST", "/produccion/edicion/previsualizar", args, payload=json.loads(args.payload))
    elif args.cmd == "confirm-video-editing":
        payload = json.loads(args.payload)
        if not isinstance(payload, dict) or "confirmacion_token" in payload:
            raise RuntimeError("Enviá el mismo objeto de intención sin confirmacion_token; usá --confirmation-token.")
        result = request("POST", "/produccion/edicion/confirmar", args, payload=operation_payload(payload, args.confirmation_token))
    elif args.cmd in ("preview-production-correction", "correct-production"):
        if not 0 < args.task_id <= 2147483647 or not 0 < args.expected_revision <= 2147483647 or not 0 < args.amount <= 9007199254740991:
            raise RuntimeError("Tarea, revisión observada y cantidad deben ser enteros positivos válidos.")
        if not args.record_id.strip() or args.record_id != args.record_id.strip() or len(args.record_id) > 200 or any(ord(c) < 32 or 127 <= ord(c) <= 159 for c in args.record_id):
            raise RuntimeError("El registro debe tener un ID exacto válido.")
        path = f"/tareas/{args.task_id}/produccion/registros/{urllib.parse.quote(args.record_id, safe='')}"
        payload = {"expected_revision": args.expected_revision, "cantidad": args.amount}
        if args.cmd == "preview-production-correction":
            result = request("POST", path + "/previsualizar", args, payload=payload)
        else:
            result = request("PATCH", path, args, payload=operation_payload(payload, args.confirmation_token))
    elif args.cmd == "ack-event":
        result = request("POST", f"/eventos/{args.task_id}/entregado", args, payload={"evento_id": args.event_id})
    elif args.cmd == "ack-group-digest":
        result = request("POST", f"/resumenes-grupos/{args.fingerprint}/entregado", args, payload=json.loads(args.payload))
    elif args.cmd == "ack-private-notification":
        result = request("POST", f"/notificaciones-privadas/{args.notification_id}/entregada", args, payload={"fingerprint": args.fingerprint})
    elif args.cmd == "get":
        result = request("GET", f"/tareas/{args.task_id}" + ("?include_archived=true" if args.include_archived else ""), args)
    elif args.cmd == "get-feedback":
        result = request("GET", f"/feedback/{args.feedback_id}", args)
    elif args.cmd == "validate":
        result = request("POST", "/tareas/validar", args, payload=json.loads(args.payload))
    elif args.cmd == "validate-feedback":
        result = request("POST", "/feedback/validar", args, payload=json.loads(args.payload))
    elif args.cmd == "propose":
        if args.operation not in ("crear", "crear_feedback") and not args.task_id:
            raise RuntimeError("Esta operación necesita --task-id.")
        payload = json.loads(args.payload)
        if args.operation in ("crear_feedback", "editar_feedback"):
            payload = feedback_payload(payload, args.idempotency_key, editing=args.operation == "editar_feedback")
        elif args.operation in ("crear", "editar", "archivar", "eliminar"):
            payload = task_operation_payload(payload, args.idempotency_key, args.expected_revision, requires_revision=args.operation != "crear")
        result = request("POST", "/confirmaciones", args, payload={
            "operacion": args.operation,
            "tarea_id": args.task_id,
            "payload": payload,
        }, idempotency_key=payload.get("idempotency_key") if args.operation != "confirmar_grabacion" else None)
    elif args.cmd == "create":
        payload = task_operation_payload(json.loads(args.payload), args.idempotency_key)
        result = request("POST", "/tareas", args, payload=operation_payload(payload, args.confirmation_token), idempotency_key=payload["idempotency_key"])
    elif args.cmd == "create-feedback":
        payload = feedback_payload(json.loads(args.payload), args.idempotency_key)
        result = request("POST", "/feedback", args, payload=operation_payload(payload, args.confirmation_token), idempotency_key=payload["idempotency_key"])
    elif args.cmd == "update-feedback":
        payload = feedback_payload(json.loads(args.payload), args.idempotency_key, editing=True, expected_updated_at=args.expected_updated_at)
        result = request("PATCH", f"/feedback/{args.feedback_id}", args, payload=operation_payload(payload, args.confirmation_token), idempotency_key=payload["idempotency_key"])
    elif args.cmd == "update":
        payload = task_operation_payload(json.loads(args.payload), args.idempotency_key, args.expected_revision, requires_revision=True)
        result = request("PATCH", f"/tareas/{args.task_id}", args, payload=operation_payload(payload, args.confirmation_token), idempotency_key=payload["idempotency_key"])
    elif args.cmd == "archive":
        payload = task_operation_payload(json.loads(args.payload), args.idempotency_key, args.expected_revision, requires_revision=True)
        result = request("POST", f"/tareas/{args.task_id}/archivar", args, payload=operation_payload(payload, args.confirmation_token), idempotency_key=payload["idempotency_key"])
    elif args.cmd == "confirm-production":
        result = request("POST", f"/tareas/{args.task_id}/confirmar-grabacion", args, payload=operation_payload({"expected_revision": args.expected_revision}, args.confirmation_token))
    else:
        payload = task_operation_payload(json.loads(args.payload), args.idempotency_key, args.expected_revision, requires_revision=True)
        result = request("DELETE", f"/tareas/{args.task_id}", args, payload=operation_payload(payload, args.confirmation_token), idempotency_key=payload["idempotency_key"])
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    try:
        main()
    except urllib.error.HTTPError as error:
        sys.stderr.write(error.read().decode("utf-8", "replace") + "\n")
        raise SystemExit(1)
    except (OSError, RuntimeError, ValueError, subprocess.SubprocessError) as error:
        sys.stderr.write(f"{error}\n")
        raise SystemExit(1)
