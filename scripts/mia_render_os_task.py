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
    if not actor_id or not actor_name or not group_id:
        raise RuntimeError("Faltan actor, nombre o grupo de WhatsApp para firmar la operación.")
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
    signature_path = f"{urllib.parse.urlparse(base_url).path}{urllib.parse.urlsplit(path).path}"
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
    get_task = commands.add_parser("get")
    get_task.add_argument("--task-id", required=True, type=int)
    validate = commands.add_parser("validate")
    validate.add_argument("--payload", required=True)
    propose = commands.add_parser("propose")
    propose.add_argument("--operation", required=True, choices=("crear", "editar", "archivar", "eliminar"))
    propose.add_argument("--task-id", type=int)
    propose.add_argument("--payload", default="{}")
    create = commands.add_parser("create")
    create.add_argument("--payload", required=True)
    create.add_argument("--confirmation-token", required=True)
    create.add_argument("--idempotency-key", required=True)
    update = commands.add_parser("update")
    update.add_argument("--task-id", required=True, type=int)
    update.add_argument("--payload", required=True)
    update.add_argument("--confirmation-token", required=True)
    update.add_argument("--idempotency-key", required=True)
    archive = commands.add_parser("archive")
    archive.add_argument("--task-id", required=True, type=int)
    archive.add_argument("--idempotency-key", required=True)
    archive.add_argument("--confirmation-token", required=True)
    delete = commands.add_parser("delete")
    delete.add_argument("--task-id", required=True, type=int)
    delete.add_argument("--confirmation-token", required=True)

    args = parser.parse_args()
    if args.cmd == "list":
        result = request("GET", f"/tareas?limit={max(1, min(args.limit, 100))}", args)
    elif args.cmd == "get":
        result = request("GET", f"/tareas/{args.task_id}", args)
    elif args.cmd == "validate":
        result = request("POST", "/tareas/validar", args, payload=json.loads(args.payload))
    elif args.cmd == "propose":
        if args.operation != "crear" and not args.task_id:
            raise RuntimeError("Esta operación necesita --task-id.")
        result = request("POST", "/confirmaciones", args, payload={
            "operacion": args.operation,
            "tarea_id": args.task_id,
            "payload": json.loads(args.payload),
        })
    elif args.cmd == "create":
        result = request("POST", "/tareas", args, payload=operation_payload(json.loads(args.payload), args.confirmation_token), idempotency_key=args.idempotency_key)
    elif args.cmd == "update":
        result = request("PATCH", f"/tareas/{args.task_id}", args, payload=operation_payload(json.loads(args.payload), args.confirmation_token), idempotency_key=args.idempotency_key)
    elif args.cmd == "archive":
        result = request("POST", f"/tareas/{args.task_id}/archivar", args, payload=operation_payload({}, args.confirmation_token), idempotency_key=args.idempotency_key)
    else:
        result = request("DELETE", f"/tareas/{args.task_id}", args, payload=operation_payload({}, args.confirmation_token))
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
