#!/usr/bin/env python3
"""Cliente de Wilson para validar, crear, consultar y editar tareas en RENDER OS.

Cada solicitud usa firma v2. Crear, editar, archivar y eliminar requieren
token exacto e idempotency key; editar/archivar/eliminar también requieren
la revisión observada. El backend verifica la identidad mapeada, no nombres.
"""

import argparse
import json
import base64
import hashlib
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
PRIVATE_KEY_PATH = pathlib.Path.home() / ".openclaw" / "credentials" / "render_os_private.pem"

SECTORS = {
    "carrusel": "diseno",
    "carruseles": "diseno",
    "historias": "diseno",
    "flyers": "diseno",
    "placas": "diseno",
    "flyers_placas": "diseno",
    "recursos": "diseno",
    "psd": "diseno",
    "recursos_psd": "diseno",
    "impresos": "diseno",
    "diseno": "diseno",
    "visitas": "produccion",
    "producciones": "produccion",
    "filmacion": "produccion",
    "produccion": "produccion",
    "edicion": "edicion",
    "cm": "community",
    "community": "community",
    "organizacion": "administracion",
    "barbi": "administracion",
    "administracion": "administracion",
    "desarrollo": "desarrollo",
}

PRIORITIES = {1: "alta", 2: "alta", 3: "media", 4: "baja"}


def canonical_json(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def signature_message(timestamp, nonce, method, path, telegram_user_id, body_hash):
    return "\n".join(("v2", timestamp, nonce, "telegram", str(telegram_user_id), "", "", method.upper(), path, body_hash))


def sign_request(method, path, telegram_user_id, payload):
    if not PRIVATE_KEY_PATH.exists():
        raise RuntimeError("Falta la clave privada de RENDER OS para Wilson.")
    timestamp = str(int(time.time()))
    nonce = str(uuid.uuid4())
    body = "" if payload is None else canonical_json(payload)
    body_hash = hashlib.sha256(body.encode("utf-8")).hexdigest()
    message = signature_message(timestamp, nonce, method, path, telegram_user_id, body_hash)
    signed = subprocess.run(
        ["openssl", "dgst", "-sha256", "-sign", str(PRIVATE_KEY_PATH)],
        input=message.encode("utf-8"), capture_output=True, check=True,
    ).stdout
    return timestamp, nonce, base64.b64encode(signed).decode("ascii"), body


def request(method, path, *, telegram_user_id, confirmed_by, payload=None, idempotency_key=None):
    base_url = os.environ.get("RENDER_OS_API_URL", DEFAULT_BASE_URL).rstrip("/")
    signature_path = f"{urllib.parse.urlparse(base_url).path}{path}"
    timestamp, nonce, signature, body = sign_request(method, signature_path, telegram_user_id, payload)
    headers = {
        "Content-Type": "application/json",
        "X-Telegram-User-Id": str(telegram_user_id),
        "X-Wilson-Channel": "telegram",
        "X-Wilson-Signature-Version": "2",
        "X-Wilson-Confirmed-By": confirmed_by,
        "X-Wilson-Timestamp": timestamp,
        "X-Wilson-Nonce": nonce,
        "X-Wilson-Signature": signature,
    }
    if idempotency_key:
        headers["Idempotency-Key"] = idempotency_key
    data = None if payload is None else body.encode("utf-8")
    req = urllib.request.Request(f"{base_url}{path}", data=data, method=method, headers=headers)
    with urllib.request.urlopen(req, timeout=30) as response:
        return json.load(response)


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


def task_payload(args):
    description = (args.desc or "").replace("\\n", "\n").strip()
    responsables = [args.assignee_name, *args.additional_assignee]
    payload = {
        "titulo": args.name.strip(),
        "descripcion": description,
        "fecha_vencimiento": args.due,
        "sector": SECTORS[args.list],
        "prioridad": PRIORITIES[args.priority],
        "material": args.material or "",
        "referencia": args.reference or "",
    }
    payload["cliente_id" if args.client_id is not None else "cliente"] = args.client_id if args.client_id is not None else args.client
    if args.assignee_id is not None:
        if args.additional_assignee:
            raise RuntimeError("No mezclar IDs y nombres de responsables.")
        payload.update(asignado_a_id=args.assignee_id, colaborador_ids=args.collaborator_id or [])
    else:
        if args.collaborator_id:
            raise RuntimeError("--collaborator-id requiere --assignee-id.")
        payload["responsables"] = responsables
    return payload


def add_task_arguments(parser, *, creating):
    parser.add_argument("--list", required=True, choices=sorted(SECTORS))
    parser.add_argument("--name", required=True)
    parser.add_argument("--desc", default="")
    client = parser.add_mutually_exclusive_group(required=True)
    client.add_argument("--client")
    client.add_argument("--client-id", type=int)
    assignee = parser.add_mutually_exclusive_group(required=True)
    assignee.add_argument("--assignee-name")
    assignee.add_argument("--assignee-id", type=int)
    parser.add_argument("--collaborator-id", action="append", type=int)
    parser.add_argument(
        "--additional-assignee", action="append", default=[],
        help="Responsable adicional. Se puede repetir.",
    )
    parser.add_argument("--due", required=True, help="YYYY-MM-DD")
    parser.add_argument("--material")
    parser.add_argument("--reference")
    parser.add_argument("--priority", type=int, choices=sorted(PRIORITIES), default=3)
    parser.add_argument("--telegram-user-id", required=True)
    parser.add_argument("--confirmed-by", default="", help="Etiqueta legacy, nunca autoridad.")
    if creating:
        parser.add_argument("--idempotency-key", required=True)
        parser.add_argument("--confirmation-token", required=True)
        parser.add_argument("--allow-duplicate", action="store_true")


def add_authorization_arguments(parser, *, idempotent=False):
    parser.add_argument("--telegram-user-id", required=True)
    parser.add_argument("--confirmed-by", default="", help="Etiqueta legacy, nunca autoridad.")
    if idempotent:
        parser.add_argument("--idempotency-key", required=True)


def update_payload(args):
    payload = {}
    values = {
        "titulo": args.name,
        "descripcion": args.desc,
        "append_descripcion": args.append_desc,
        "cliente": args.client,
        "fecha_vencimiento": args.due,
        "material": args.material,
        "referencia": args.reference,
    }
    if args.payload is not None:
        if (any(value is not None for value in values.values())
                or any(value is not None for value in [args.assignee_name, args.additional_assignee,
                       args.assignee_id, args.collaborator_id, args.list, args.priority, args.client_id])):
            raise RuntimeError("Usá --payload o flags de negocio, no ambos.")
        return json.loads(args.payload)
    if args.assignee_id is not None or args.collaborator_id is not None:
        if args.assignee_name is not None or args.additional_assignee is not None:
            raise RuntimeError("No mezclar IDs y nombres de responsables.")
        if args.assignee_id is not None:
            payload["asignado_a_id"] = args.assignee_id
        if args.collaborator_id is not None:
            payload["colaborador_ids"] = args.collaborator_id
    elif args.assignee_name is not None or args.additional_assignee is not None:
        payload["responsables"] = [
            name for name in [args.assignee_name, *(args.additional_assignee or [])] if name
        ]
    for key, value in values.items():
        if value is not None:
            payload[key] = value.replace("\\n", "\n").strip() if isinstance(value, str) else value
    if args.list is not None:
        payload["sector"] = SECTORS[args.list]
    if args.priority is not None:
        payload["prioridad"] = PRIORITIES[args.priority]
    if args.client_id is not None:
        if args.client is not None:
            raise RuntimeError("No mezclar ID y nombre de cliente.")
        payload["cliente_id"] = args.client_id
    return payload


def main():
    parser = argparse.ArgumentParser()
    commands = parser.add_subparsers(dest="cmd", required=True)
    commands.add_parser("catalog")
    validate = commands.add_parser("validate")
    add_task_arguments(validate, creating=False)
    create = commands.add_parser("create")
    add_task_arguments(create, creating=True)
    get_task = commands.add_parser("get")
    get_task.add_argument("--task-id", required=True, type=int)
    get_task.add_argument("--include-archived", action="store_true")
    add_authorization_arguments(get_task)
    update = commands.add_parser("update")
    update.add_argument("--task-id", required=True, type=int)
    update.add_argument("--payload", help="JSON explícito; no combinar con flags de negocio.")
    update.add_argument("--list", choices=sorted(SECTORS))
    update.add_argument("--name")
    description = update.add_mutually_exclusive_group()
    description.add_argument("--desc", help="Reemplaza la descripción completa.")
    description.add_argument("--append-desc", help="Agrega un bloque al final sin duplicarlo.")
    update.add_argument("--client")
    update.add_argument("--client-id", type=int)
    update.add_argument("--assignee-name")
    update.add_argument("--assignee-id", type=int)
    update.add_argument("--collaborator-id", action="append", type=int)
    update.add_argument(
        "--additional-assignee", action="append",
        help="Reemplaza los responsables adicionales. Se puede repetir.",
    )
    update.add_argument("--due", help="YYYY-MM-DD")
    update.add_argument("--material")
    update.add_argument("--reference")
    update.add_argument("--priority", type=int, choices=sorted(PRIORITIES))
    add_authorization_arguments(update, idempotent=True)
    update.add_argument("--confirmation-token", required=True)
    update.add_argument("--expected-revision", type=int)
    propose = commands.add_parser("propose")
    propose.add_argument("--operation", required=True, choices=("crear", "editar", "archivar", "eliminar"))
    propose.add_argument("--task-id", type=int)
    propose.add_argument("--payload", default="{}")
    propose.add_argument("--expected-revision", type=int)
    add_authorization_arguments(propose)
    propose.add_argument("--idempotency-key")
    for name in ("archive", "delete"):
        mutation = commands.add_parser(name)
        mutation.add_argument("--task-id", required=True, type=int)
        mutation.add_argument("--expected-revision", type=int)
        mutation.add_argument("--payload", default="{}")
        mutation.add_argument("--confirmation-token", required=True)
        add_authorization_arguments(mutation, idempotent=True)
    args = parser.parse_args()

    if args.cmd == "catalog":
        telegram_user_id = os.environ.get("WILSON_TELEGRAM_USER_ID")
        confirmed_by = os.environ.get("WILSON_CONFIRMED_BY", "")
        if not telegram_user_id:
            raise RuntimeError("Para consultar el catálogo falta WILSON_TELEGRAM_USER_ID.")
        result = request("GET", "/catalogo", telegram_user_id=telegram_user_id, confirmed_by=confirmed_by)
    elif args.cmd in ("validate", "create"):
        payload = task_payload(args)
        if args.cmd == "validate":
            result = request(
                "POST", "/tareas/validar", telegram_user_id=args.telegram_user_id,
                confirmed_by=args.confirmed_by, payload=payload,
            )
        else:
            payload["permitir_duplicado"] = args.allow_duplicate
            payload = task_operation_payload(payload, args.idempotency_key)
            payload["confirmacion_token"] = args.confirmation_token
            result = request(
                "POST", "/tareas", telegram_user_id=args.telegram_user_id,
                confirmed_by=args.confirmed_by, payload=payload,
                idempotency_key=payload["idempotency_key"],
            )
    elif args.cmd == "get":
        result = request(
            "GET", f"/tareas/{args.task_id}" + ("?include_archived=true" if args.include_archived else ""), telegram_user_id=args.telegram_user_id,
            confirmed_by=args.confirmed_by,
        )
    elif args.cmd == "propose":
        if args.operation != "crear" and not args.task_id:
            raise RuntimeError("Esta operación necesita --task-id.")
        payload = task_operation_payload(json.loads(args.payload), args.idempotency_key, args.expected_revision, requires_revision=args.operation != "crear")
        result = request("POST", "/confirmaciones", telegram_user_id=args.telegram_user_id,
                         confirmed_by=args.confirmed_by, idempotency_key=payload["idempotency_key"],
                         payload={"operacion": args.operation, "tarea_id": args.task_id if args.operation != "crear" else None, "payload": payload})
    else:
        payload = task_operation_payload(update_payload(args) if args.cmd == "update" else json.loads(args.payload), args.idempotency_key, args.expected_revision, requires_revision=True)
        payload["confirmacion_token"] = args.confirmation_token
        method = "PATCH" if args.cmd == "update" else "POST" if args.cmd == "archive" else "DELETE"
        path = f"/tareas/{args.task_id}" + ("/archivar" if args.cmd == "archive" else "")
        result = request(
            method, path, telegram_user_id=args.telegram_user_id,
            confirmed_by=args.confirmed_by, payload=payload,
            idempotency_key=payload["idempotency_key"],
        )
    print(json.dumps(result, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except urllib.error.HTTPError as error:
        sys.stderr.write(error.read().decode("utf-8", "replace") + "\n")
        raise SystemExit(1)
    except (OSError, RuntimeError, ValueError) as error:
        sys.stderr.write(f"{error}\n")
        raise SystemExit(1)
