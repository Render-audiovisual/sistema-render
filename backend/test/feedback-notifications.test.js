import assert from "node:assert/strict";
import test from "node:test";
import {
  countNewFeedback,
  feedbackSeenStorageKey,
  markFeedbackSeen,
  readFeedbackSeenAt,
} from "../../frontend/src/features/render-os/utils/feedback-notifications.js";

test("feedback notifications are isolated per user", () => {
  const values = new Map();
  const storage = { getItem: (key) => values.get(key) || null, setItem: (key, value) => values.set(key, value) };
  const user = { id: 7, usuario: "oriana" };
  markFeedbackSeen(user, "2026-09-20T12:00:00.000Z", storage);
  assert.equal(readFeedbackSeenAt(user, storage), "2026-09-20T12:00:00.000Z");
  assert.equal(feedbackSeenStorageKey(user), "render_feedback_seen_at:7");
});

test("only active feedback created after the last visit is counted", () => {
  const notes = [
    { created_at: "2026-09-20T11:00:00.000Z" },
    { created_at: "2026-09-20T13:00:00.000Z" },
    { created_at: "2026-09-20T14:00:00.000Z", eliminado_at: "2026-09-20T15:00:00.000Z" },
  ];
  assert.equal(countNewFeedback(notes, "2026-09-20T12:00:00.000Z"), 1);
});
