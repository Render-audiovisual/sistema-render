// Presentation-only protection. Never treats leaving as cancellation or rollback.
export function uploadNavigationState({hasFile, uploading, blocked, refreshFailed}) {
  return {dirty:Boolean(hasFile || blocked || refreshFailed),busy:Boolean(uploading)};
}
