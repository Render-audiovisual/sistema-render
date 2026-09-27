import crypto from "node:crypto";

export function normalizeFeedbackSearchText(value) {
  return String(value || "").normalize("NFD").replace(/\p{Diacritic}/gu, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function feedbackTokens(value) {
  return new Set(normalizeFeedbackSearchText(value).split(/\s+/).filter((token) => token.length > 2));
}

export function feedbackSimilarity(left, right) {
  const a = feedbackTokens(left);
  const b = feedbackTokens(right);
  if (!a.size || !b.size) return 0;
  const intersection = [...a].filter((token) => b.has(token)).length;
  return intersection / new Set([...a, ...b]).size;
}

export function findSimilarFeedback(candidate, notes, threshold = 0.42) {
  const client = normalizeFeedbackSearchText(candidate.cliente);
  const text = `${candidate.titulo || ""} ${candidate.contenido || ""}`;
  return notes.flatMap((note) => {
    const noteClient = normalizeFeedbackSearchText(note.feedback?.cliente);
    if (client !== noteClient) return [];
    const score = feedbackSimilarity(text, `${note.titulo || ""} ${note.contenido || ""}`);
    return score >= threshold ? [{
      id: note.id,
      titulo: note.titulo,
      cliente: note.feedback?.cliente || "",
      estado: note.feedback?.estado || "pendiente",
      similitud: Number(score.toFixed(2)),
      updated_at: note.updated_at,
    }] : [];
  }).sort((left, right) => right.similitud - left.similitud).slice(0, 5);
}

export function feedbackFingerprint(parts) {
  return crypto.createHash("sha256").update(JSON.stringify(parts)).digest("hex");
}
