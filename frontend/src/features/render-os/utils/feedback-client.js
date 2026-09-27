export function normalizeFeedbackText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

export function resolveFeedbackClient(note, clientNames = []) {
  const explicitClient = String(note?.feedback?.cliente || "").trim();
  if (explicitClient) return explicitClient;

  const normalizedTitle = normalizeFeedbackText(note?.titulo);
  if (!normalizedTitle) return "";

  const matches = clientNames.filter((clientName) => {
    const normalizedClient = normalizeFeedbackText(clientName).trim();
    if (!normalizedClient) return false;
    if (normalizedTitle.includes(normalizedClient)) return true;

    const meaningfulTokens = normalizedClient
      .split(/[^a-z0-9]+/)
      .filter((token) => token.length >= 4);
    return meaningfulTokens.some((token) => normalizedTitle.includes(token));
  });

  return matches.length === 1 ? matches[0] : "";
}

export function isClientFeedback(note, clientNames = []) {
  return Boolean(resolveFeedbackClient(note, clientNames));
}
