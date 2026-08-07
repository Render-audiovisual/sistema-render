#!/usr/bin/env python3
"""Cliente de Wilson para validar, crear, consultar y editar tareas en RENDER OS.

La credencial se obtiene de RENDER_OS_WILSON_TOKEN o de
~/.openclaw/credentials/render_os.json. Crear exige confirmación explícita e
idempotency key; el backend vuelve a validar catálogo y duplicados. Editar exige
la misma confirmación y una clave de idempotencia.
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
}

PRIORITIES = {1: "alta", 2: "alta", 3: "media", 4: "baja"}


def canonical_json(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def sign_request(method, path, telegram_user_id, payload):
    if not PRIVATE_KEY_PATH.exists():
        raise RuntimeError("Falta la clave privada de RENDER OS para Wilson.")
    timestamp = str(int(time.time()))
    nonce = str(uuid.uuid4())
    body = "" if payload is None else canonical_json(payload)
    body_hash = hashlib.sha256(body.encode("utf-8")).hexdigest()
    message = "\n".join((timestamp, nonce, str(telegram_user_id), method.upper(), path, body_hash))
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


def task_payload(args):
    description = (args.desc or "").replace("\\n", "\n").strip()
    return {
        "titulo": args.name.strip(),
        "descripcion": description,
        "cliente": args.client,
        "responsable": args.assignee_name,
        "fecha_vencimiento": args.due,
        "sector": SECTORS[args.list],
        "prioridad": PRIORITIES[args.priority],
        "material": args.material or "",
        "referencia": args.reference or "",
    }


def add_task_arguments(parser, *, creating):
    parser.add_argument("--list", required=True, choices=sorted(SECTORS))
    parser.add_argument("--name", required=True)
    parser.add_argument("--desc", default="")
    parser.add_argument("--client", required=True)
    parser.add_argument("--assignee-name", required=True)
    parser.add_argument("--due", required=True, help="YYYY-MM-DD")
    parser.add_argument("--material")
    parser.add_argument("--reference")
    parser.add_argument("--priority", type=int, choices=sorted(PRIORITIES), default=3)
    parser.add_argument("--telegram-user-id", required=True)
    parser.add_argument("--confirmed-by", required=True, choices=("Franco", "Agustín"))
    if creating:
        parser.add_argument("--idempotency-key", required=True)
        parser.add_argument("--allow-duplicate", action="store_true")


def add_authorization_arguments(parser, *, idempotent=False):
    parser.add_argument("--telegram-user-id", required=True)
    parser.add_argument("--confirmed-by", required=True, choices=("Franco", "Agustín"))
    if idempotent:
        parser.add_argument("--idempotency-key", required=True)


def update_payload(args):
    payload = {"confirmado": True}
    values = {
        "titulo": args.name,
        "descripcion": args.desc,
        "append_descripcion": args.append_desc,
        "cliente": args.client,
        "responsable": args.assignee_name,
        "fecha_vencimiento": args.due,
        "material": args.material,
        "referencia": args.reference,
    }
    for key, value in values.items():
        if value is not None:
            payload[key] = value.replace("\\n", "\n").strip() if isinstance(value, str) else value
    if args.list is not None:
        payload["sector"] = SECTORS[args.list]
    if args.priority is not None:
        payload["prioridad"] = PRIORITIES[args.priority]
    if len(payload) == 1:
        raise RuntimeError("La edición no contiene ningún cambio.")
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
    add_authorization_arguments(get_task)
    update = commands.add_parser("update")
    update.add_argument("--task-id", required=True, type=int)
    update.add_argument("--list", choices=sorted(SECTORS))
    update.add_argument("--name")
    description = update.add_mutually_exclusive_group()
    description.add_argument("--desc", help="Reemplaza la descripción completa.")
    description.add_argument("--append-desc", help="Agrega un bloque al final sin duplicarlo.")
    update.add_argument("--client")
    update.add_argument("--assignee-name")
    update.add_argument("--due", help="YYYY-MM-DD")
    update.add_argument("--material")
    update.add_argument("--reference")
    update.add_argument("--priority", type=int, choices=sorted(PRIORITIES))
    add_authorization_arguments(update, idempotent=True)
    args = parser.parse_args()

    if args.cmd == "catalog":
        telegram_user_id = os.environ.get("WILSON_TELEGRAM_USER_ID")
        confirmed_by = os.environ.get("WILSON_CONFIRMED_BY", "Franco")
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
            payload.update({"confirmado": True, "permitir_duplicado": args.allow_duplicate})
            result = request(
                "POST", "/tareas", telegram_user_id=args.telegram_user_id,
                confirmed_by=args.confirmed_by, payload=payload,
                idempotency_key=args.idempotency_key,
            )
    elif args.cmd == "get":
        result = request(
            "GET", f"/tareas/{args.task_id}", telegram_user_id=args.telegram_user_id,
            confirmed_by=args.confirmed_by,
        )
    else:
        result = request(
            "PATCH", f"/tareas/{args.task_id}", telegram_user_id=args.telegram_user_id,
            confirmed_by=args.confirmed_by, payload=update_payload(args),
            idempotency_key=args.idempotency_key,
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
