"""Offline regression tests: no subprocesses, backend calls or WhatsApp sends."""
import pathlib
import os
import tempfile
import unittest
from unittest.mock import patch
from concurrent.futures import ThreadPoolExecutor

import mia_event_worker as worker


class DeliveryGuardTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path = pathlib.Path(self.tmp.name) / "receipts.sqlite3"
        self.event = {"id": "event-123", "kind": "event", "destination": "edicion"}
        self.environ = patch.dict(os.environ, {"MIA_PRIVATE_RECIPIENTS_JSON": '{"test":"test-target"}'})
        self.environ.start()
        self.addCleanup(self.environ.stop)

    def send(self, event=None):
        return worker.guarded_delivery(event or self.event, account="test", ledger_path=self.path)

    def test_backend_ack_failure_and_restart_do_not_resend(self):
        with patch.object(worker, "deliver_event", return_value={"messageId": "test"}) as send:
            self.send()
            # The caller fails to acknowledge. Next run opens a new DB connection.
            self.assertEqual(self.send()["status"], "already_sent")
            self.assertEqual(send.call_count, 1)

    def test_uncertain_transport_result_is_not_retried(self):
        with patch.object(worker, "deliver_event", side_effect=TimeoutError("unknown")) as send:
            with self.assertRaises(TimeoutError):
                self.send()
            with self.assertRaisesRegex(RuntimeError, "incierto"):
                self.send()
            self.assertEqual(send.call_count, 1)

    def test_crash_after_send_before_receipt_is_not_retried(self):
        with patch.object(worker, "deliver_event", side_effect=SystemExit) as send:
            with self.assertRaises(SystemExit):
                self.send()
            with self.assertRaises(RuntimeError):
                self.send()
            self.assertEqual(send.call_count, 1)

    def test_separate_events_and_destinations_are_not_suppressed(self):
        with patch.object(worker, "deliver_event", return_value={"messageId": "test"}) as send:
            self.send()
            self.send({**self.event, "id": "event-124"})
            self.send({**self.event, "destination": "visitas"})
            self.assertEqual(send.call_count, 3)

    def test_concurrent_workers_send_only_once(self):
        def attempt(_):
            try:
                return self.send()
            except RuntimeError:
                return "held"
        with patch.object(worker, "deliver_event", return_value={"messageId": "test"}) as send:
            with ThreadPoolExecutor(max_workers=4) as pool:
                list(pool.map(attempt, range(8)))
            self.assertEqual(send.call_count, 1)

    def test_all_event_kinds_are_protected(self):
        for kind in ("event", "digest", "private"):
            with self.subTest(kind=kind):
                with patch.object(worker, "deliver_event", return_value={"messageId": "test"}) as send:
                    event = {**self.event, "kind": kind, **({"destinatario_clave":"test"} if kind == "private" else {})}
                    self.send(event)
                    self.send(event)
                    self.assertEqual(send.call_count, 1)

    def test_missing_id_fails_before_send(self):
        with patch.object(worker, "deliver_event") as send:
            with self.assertRaises(ValueError):
                self.send({"kind": "event"})
            send.assert_not_called()

    def test_only_acknowledged_old_digests_can_repeat(self):
        event = {**self.event, "kind": "digest"}
        with patch.object(worker, "deliver_event", return_value={"messageId": "test"}) as send:
            self.send(event)
            with worker.sqlite3.connect(self.path) as db:
                db.execute("UPDATE deliveries SET updated_at=datetime('now','-2 days')")
            self.send(event)  # Missing backend ACK, even after two days: no resend.
            self.assertEqual(send.call_count, 1)
            worker.acknowledge_receipt(event, account="test", ledger_path=self.path)
            self.send(event)  # Normal scheduled recurrence is still allowed.
            self.assertEqual(send.call_count, 2)

    def test_old_uncertain_digest_stays_held(self):
        event = {**self.event, "kind": "digest"}
        with patch.object(worker, "deliver_event", side_effect=TimeoutError) as send:
            with self.assertRaises(TimeoutError):
                self.send(event)
            with worker.sqlite3.connect(self.path) as db:
                db.execute("UPDATE deliveries SET updated_at=datetime('now','-2 days')")
            with self.assertRaises(RuntimeError):
                self.send(event)
            self.assertEqual(send.call_count, 1)

    def test_unwritable_ledger_fails_before_send(self):
        self.path.mkdir()
        with patch.object(worker, "deliver_event") as send:
            with self.assertRaises(worker.sqlite3.Error):
                self.send()
            send.assert_not_called()

    def test_no_receipt_is_uncertain_and_not_acknowledged(self):
        with patch.object(worker, "deliver_event", return_value={"status":"ok"}) as send:
            with self.assertRaisesRegex(RuntimeError, "recibo"):
                self.send()
            with self.assertRaisesRegex(RuntimeError, "incierto"):
                self.send()
            self.assertEqual(send.call_count, 1)

    def test_missing_private_mapping_does_not_poison_the_ledger(self):
        event = {**self.event, "kind":"private", "destinatario_clave":"unlinked"}
        with patch.object(worker, "deliver_event") as send:
            with self.assertRaises(ValueError):
                self.send(event)
            send.assert_not_called()
            self.assertFalse(self.path.exists())

    def test_nested_receipt_is_accepted_but_dry_run_is_not(self):
        self.assertTrue(worker.confirmed_transport_receipt({"payload":{"result":{"messageId":"receipt"}}}))
        self.assertFalse(worker.confirmed_transport_receipt({"dryRun":True,"messageId":"receipt"}))

    def test_existing_vps_group_suppression_keeps_private_reels_enabled(self):
        self.assertTrue(worker.suppress_group_followup({"kind":"event","text":"Reel listo para revisar"}))
        self.assertTrue(worker.suppress_group_followup({"kind":"digest","title":"Carrusel atrasado"}))
        self.assertFalse(worker.suppress_group_followup({"kind":"private","text":"Reel atrasado"}))
        self.assertFalse(worker.suppress_group_followup({"kind":"event","text":"Visita completada"}))

    def test_global_private_cooldown_between_different_modules(self):
        event={**self.event,"kind":"private","destinatario_clave":"test","motivo":"asignacion"}
        with patch.object(worker,"deliver_event",return_value={"messageId":"test"}) as send:
            self.send(event)
            result=self.send({**event,"id":"different-module","motivo":"recordatorio_lista"})
            self.assertEqual(result["status"],"deferred")
            self.assertEqual(result["reason"],"recipient_cooldown")
            self.assertEqual(send.call_count,1)
            with worker.sqlite3.connect(self.path) as db:
                self.assertEqual(db.execute("SELECT COUNT(*) FROM deliveries").fetchone()[0],1)

    def test_supervisor_once_per_person_work_window_even_after_cooldown(self):
        event={**self.event,"kind":"private","destinatario_clave":"test","motivo":"supervisor_seguimiento"}
        with patch.object(worker,"proactive_window",return_value="2026-10-03:am"),patch.object(worker,"deliver_event",return_value={"messageId":"test"}) as send:
            self.send(event)
            with worker.sqlite3.connect(self.path) as db:
                db.execute("UPDATE private_contacts SET last_attempt=last_attempt-3600")
            self.assertEqual(self.send({**event,"id":"other-task"})["reason"],"work_window_quota")
            self.assertEqual(send.call_count,1)
            with patch.object(worker,"proactive_window",return_value="2026-10-03:pm"):
                self.send({**event,"id":"other-task"})
            self.assertEqual(send.call_count,2)

    def test_aliases_for_same_actual_phone_do_not_bypass_cooldown(self):
        event={**self.event,"kind":"private","destinatario_clave":"test"}
        with patch.dict(os.environ,{"MIA_PRIVATE_RECIPIENTS_JSON":'{"test":"test-target","alias":"test-target"}'}),patch.object(worker,"deliver_event",return_value={"messageId":"test"}) as send:
            self.send(event)
            self.assertEqual(self.send({**event,"id":"another-alias","destinatario_clave":"alias"})["status"],"deferred")
            self.assertEqual(send.call_count,1)

    def test_uncertain_send_also_holds_global_recipient_cooldown(self):
        event={**self.event,"kind":"private","destinatario_clave":"test"}
        with patch.object(worker,"deliver_event",side_effect=TimeoutError) as send:
            with self.assertRaises(TimeoutError): self.send(event)
            self.assertEqual(self.send({**event,"id":"other-module"})["status"],"deferred")
            self.assertEqual(send.call_count,1)

    def test_window_boundaries_and_sunday(self):
        for hour,expected in (("08:00","am"),("12:59","am"),("13:00",None),("17:00","pm"),("21:29","pm"),("21:30",None)):
            date=worker.datetime.fromisoformat(f"2026-10-03T{hour}:00-03:00")
            self.assertEqual(worker.proactive_window(date),f"2026-10-03:{expected}" if expected else None)
        self.assertIsNone(worker.proactive_window(worker.datetime.fromisoformat("2026-10-04T09:00:00-03:00")))


if __name__ == "__main__":
    unittest.main()
