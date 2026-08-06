export function getTaskSearchTerms(value, maxTerms = 12) {
  return String(value || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, maxTerms);
}
