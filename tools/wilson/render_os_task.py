#!/usr/bin/env python3
"""Cliente de Wilson para validar y crear tareas en RENDER OS.

La credencial se obtiene de RENDER_OS_WILSON_TOKEN o de
~/.openclaw/credentials/render_os.json. Crear exige confirmación explícita e
idempotency key; el backend vuelve a validar catálogo y duplicados.
"""

import argparse
import json
import os
import pathlib
import sys
import urllib.error
import urllib.request


DEFAULT_BASE_URL = "https://sistema.rendercorrientes.com/api/integraciones/wilson"
CREDENTIALS_PATH = pathlib.Path.home() / ".openclaw" / "credentials" / "render_os.json"

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


def load_credentials():
    data = {}
    if CREDENTIALS_PATH.exists():
        data = json.loads(CREDENTIALS_PATH.read_text(encoding="utf-8"))
    token = os.environ.get("RENDER_OS_WILSON_TOKEN") or data.get("api_token")
    base_url = os.environ.get("RENDER_OS_API_URL") or data.get("base_url") or DEFAULT_BASE_URL
    if not token:
        raise RuntimeError("Falta configurar la credencial técnica de RENDER OS para Wilson.")
    return token, base_url.rstrip("/")


def request(method, path, *, telegram_user_id, confirmed_by, payload=None, idempotency_key=None):
    token, base_url = load_credentials()
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
        "X-Telegram-User-Id": str(telegram_user_id),
        "X-Wilson-Confirmed-By": confirmed_by,
    }
    if idempotency_key:
        headers["Idempotency-Key"] = idempotency_key
    data = None if payload is None else json.dumps(payload).encode("utf-8")
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


def main():
    parser = argparse.ArgumentParser()
    commands = parser.add_subparsers(dest="cmd", required=True)
    commands.add_parser("catalog")
    validate = commands.add_parser("validate")
    add_task_arguments(validate, creating=False)
    create = commands.add_parser("create")
    add_task_arguments(create, creating=True)
    args = parser.parse_args()

    if args.cmd == "catalog":
        telegram_user_id = os.environ.get("WILSON_TELEGRAM_USER_ID")
        confirmed_by = os.environ.get("WILSON_CONFIRMED_BY", "Franco")
        if not telegram_user_id:
            raise RuntimeError("Para consultar el catálogo falta WILSON_TELEGRAM_USER_ID.")
        result = request("GET", "/catalogo", telegram_user_id=telegram_user_id, confirmed_by=confirmed_by)
    else:
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
