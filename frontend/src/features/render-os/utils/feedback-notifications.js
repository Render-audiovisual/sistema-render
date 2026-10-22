const STORAGE_PREFIX = "render_feedback_seen_at";

function userKey(user) {
  return String(user?.id || user?.usuario || user?.email || "").trim().toLowerCase();
}
export function feedbackSeenStorageKey(user) {
  const key = userKey(user);
  return key ? `${STORAGE_PREFIX}:${key}` : "";
}

export function readFeedbackSeenAt(user, storage) {
  const key = feedbackSeenStorageKey(user);
  if (!key) return null;
  try {
    const available = storage === undefined ? globalThis.localStorage : storage;
    return available ? available.getItem(key) : null;
  }
  catch { return null; }
}

export function markFeedbackSeen(user, value = new Date().toISOString(), storage) {
  const key = feedbackSeenStorageKey(user);
  if (!key) return;
  try {
    const available = storage === undefined ? globalThis.localStorage : storage;
    if (available) available.setItem(key, value);
  }
  catch { /* El aviso no debe bloquear el trabajo si el navegador limita el almacenamiento. */ }
}

export function countNewFeedback(notes, seenAt) {
  if (!seenAt) return 0;
  const seenTime = Date.parse(seenAt);
  if (!Number.isFinite(seenTime)) return 0;
  return (Array.isArray(notes) ? notes : []).filter((note) => {
    const createdTime = Date.parse(note?.created_at);
    return Number.isFinite(createdTime) && createdTime > seenTime && !note?.eliminado_at;
  }).length;
}
