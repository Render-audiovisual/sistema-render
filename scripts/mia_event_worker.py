#!/usr/bin/env python3
"""Entrega eventos confirmados de RENDER OS a los grupos operativos de MIA.

Por seguridad el modo predeterminado es simulación. Solo ``--send`` publica en
WhatsApp y confirma el evento en el backend después de una entrega exitosa.
"""

import argparse
import fcntl
import hashlib
import json
import os
import pathlib
import subprocess
import sqlite3
import sys


DESTINATION_GROUPS = {
    "render_brain": "120363198390531088@g.us",
    "visitas": "120363424116130520@g.us",
    "edicion": "120363407058957027@g.us",
    "comunicacion": "120363408089713191@g.us",
}
DEFAULT_ACCOUNT = "render-3794145157"
DEFAULT_CLIENT = pathlib.Path(__file__).with_name("mia_render_os_task.py")
DEFAULT_LOCK = pathlib.Path("/tmp/mia-render-os-events.lock")
DEFAULT_LEDGER = pathlib.Path(__file__).resolve().parent / "state" / "mia-deliveries.sqlite3"


def delivery_key(event, account):
    return hashlib.sha256(json.dumps([
        account, event.get("kind"), event.get("id"),
        event.get("destinatario_clave") or event.get("destination"),
    ], sort_keys=True).encode()).hexdigest()


def acknowledge_receipt(event, *, account, ledger_path):
    with sqlite3.connect(ledger_path, timeout=10) as db:
        db.execute("UPDATE deliveries SET status='acked' WHERE id=? AND status='sent'",
                   (delivery_key(event, account),))


def guarded_delivery(event, *, account, ledger_path):
    """Persist intent BEFORE sending. Unknown outcomes must never be retried blindly.

    A sent receipt survives a failed backend acknowledgement and process restarts.
    Acknowledged digests may intentionally recur after the backend's 24h cooldown.
    No message text or phone number is stored in this ledger.
    """
    event_id = event.get("id")
    if not event_id:
        raise ValueError("Falta el identificador estable del evento.")
    key = delivery_key(event, account)
    ledger_path = pathlib.Path(ledger_path)
    ledger_path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    with sqlite3.connect(ledger_path, timeout=10) as db:
        os.chmod(ledger_path, 0o600)
        db.execute("PRAGMA synchronous=FULL")
        db.execute("CREATE TABLE IF NOT EXISTS deliveries (id TEXT PRIMARY KEY, status TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)")
        db.execute("BEGIN IMMEDIATE")
        row = db.execute("SELECT status, updated_at <= datetime('now', '-24 hours') FROM deliveries WHERE id=?", (key,)).fetchone()
        if row and row[0] == "acked" and row[1] and event.get("kind") == "digest":
            db.execute("DELETE FROM deliveries WHERE id=?", (key,))
            row = None
        if row:
            db.commit()
            if row[0] in ("sent", "acked"):
                return {"status": "already_sent", "resend": False}
            raise RuntimeError("Envío incierto retenido para revisión; no se reenviará automáticamente.")
        db.execute("INSERT INTO deliveries(id,status) VALUES (?, 'uncertain')", (key,))
        db.commit()
        # Any exception/crash from this point leaves the durable uncertain marker.
        result = deliver_event(event, account=account, send=True)
        db.execute("UPDATE deliveries SET status='sent',updated_at=CURRENT_TIMESTAMP WHERE id=?", (key,))
        db.commit()
        return result


def format_event(event):
    text = str(event.get("text") or "").strip()
    task_url = str(event.get("task_url") or event.get("url") or "").strip()
    if not text:
        raise ValueError("El evento no contiene texto.")
    return f"{text}\n\nAbrir tarea: {task_url}" if task_url else text


def private_recipients():
    raw = os.environ.get("MIA_PRIVATE_RECIPIENTS_JSON", "{}").strip()
    values = json.loads(raw or "{}")
    if not isinstance(values, dict):
        raise ValueError("MIA_PRIVATE_RECIPIENTS_JSON debe ser un objeto JSON.")
    return {str(key).strip().lower(): str(value).strip() for key, value in values.items() if str(value).strip()}


def run_json(command):
    result = subprocess.run(command, capture_output=True, text=True, check=True)
    return json.loads(result.stdout)


def client_identity():
    values = {
        "actor_id": os.environ.get("MIA_RENDER_OS_ACTOR_ID", "mia-system").strip(),
        "actor_name": os.environ.get("MIA_RENDER_OS_ACTOR_NAME", "MIA").strip(),
        "group_id": os.environ.get("MIA_RENDER_OS_CONTROL_GROUP_ID", DESTINATION_GROUPS["render_brain"]).strip(),
    }
    return values


def client_command(identity, *arguments):
    return [
        sys.executable, str(DEFAULT_CLIENT),
        "--actor-id", identity["actor_id"],
        "--actor-name", identity["actor_name"],
        "--group-id", identity["group_id"],
        *arguments,
    ]


def deliver_event(event, *, account, send):
    destination = str(event.get("destination") or "")
    if event.get("kind") == "private":
        target = private_recipients().get(str(event.get("destinatario_clave") or "").strip().lower())
        if not target:
            raise ValueError(f"Falta vincular el WhatsApp privado de {event.get('destinatario') or destination or '(desconocido)'}.")
    else:
        target = DESTINATION_GROUPS.get(destination)
    if not target:
        raise ValueError(f"Destino de MIA desconocido: {destination or '(vacío)'}")
    command = [
        "openclaw", "message", "send",
        "--channel", "whatsapp",
        "--account", account,
        "--target", target,
        "--message", format_event(event),
        "--json",
    ]
    if not send:
        command.append("--dry-run")
    return run_json(command)


def main():
    parser = argparse.ArgumentParser()
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--send", action="store_true", help="Publica en WhatsApp y confirma las entregas.")
    mode.add_argument("--dry-run", action="store_true", help="Simula la entrega (modo predeterminado).")
    parser.add_argument("--max-events", type=int, default=10)
    parser.add_argument("--account", default=os.environ.get("MIA_OPENCLAW_ACCOUNT", DEFAULT_ACCOUNT))
    parser.add_argument("--lock-file", type=pathlib.Path, default=DEFAULT_LOCK)
    parser.add_argument("--ledger-file", type=pathlib.Path,
                        default=pathlib.Path(os.environ.get("MIA_DELIVERY_LEDGER", str(DEFAULT_LEDGER))))
    args = parser.parse_args()
    limit = max(1, min(args.max_events, 50))
    identity = client_identity()

    args.lock_file.parent.mkdir(parents=True, exist_ok=True)
    with args.lock_file.open("w") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            print(json.dumps({"status": "busy", "delivered": 0}))
            return 0

        response = run_json(client_command(identity, "events"))
        digest_response = run_json(client_command(identity, "group-digests"))
        private_response = run_json(client_command(identity, "private-notifications", "--limit", str(limit)))
        events = ([{**event, "kind": "private", "text": event.get("mensaje")} for event in private_response.get("notifications") or []]
                  + [{**event, "kind": "event"} for event in response.get("events") or []]
                  + [{**digest, "kind": "digest"} for digest in digest_response.get("digests") or []])[:limit]
        delivered = []
        errors = []
        for event in events:
            try:
                result = (guarded_delivery(event, account=args.account, ledger_path=args.ledger_file)
                          if args.send else deliver_event(event, account=args.account, send=False))
                if args.send:
                    if event.get("kind") == "private":
                        run_json(client_command(
                            identity, "ack-private-notification",
                            "--notification-id", str(event["id"]),
                            "--fingerprint", str(event["fingerprint"]),
                        ))
                    elif event.get("kind") == "digest":
                        payload = json.dumps({
                            "destination": event["destination"], "period": event["period"],
                            "level": event["level"], "task_ids": event.get("task_ids", []),
                            "clients": event.get("clients", []),
                        }, ensure_ascii=False)
                        run_json(client_command(identity, "ack-group-digest", "--fingerprint", event["id"], "--payload", payload))
                    else:
                        run_json(client_command(
                            identity, "ack-event",
                            "--task-id", str(event["task_id"]),
                            "--event-id", str(event["id"]),
                        ))
                    acknowledge_receipt(event, account=args.account, ledger_path=args.ledger_file)
                delivered.append({"event_id": event.get("id"), "destination": event.get("destination") or event.get("destinatario_clave"), "result": result})
            except (KeyError, ValueError, RuntimeError, OSError, sqlite3.Error, json.JSONDecodeError, subprocess.CalledProcessError) as error:
                errors.append({"event_id": event.get("id"), "error": str(error)})

        print(json.dumps({
            "mode": "send" if args.send else "dry-run",
            "pending": len(events),
            "delivered": len(delivered),
            "errors": errors,
            "results": delivered,
        }, ensure_ascii=False, indent=2))
        return 1 if errors else 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, RuntimeError, subprocess.CalledProcessError, json.JSONDecodeError) as error:
        sys.stderr.write(f"{error}\n")
        raise SystemExit(1)
