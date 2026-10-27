// Presentation hint only. Never supplies credentials, an account ID or a role.
export const OWNER_ACCESS_CHOICES = Object.freeze([
  Object.freeze({ id: 'franco', label: 'Franco' }),
  Object.freeze({ id: 'agustin', label: 'Agustín' }),
]);
const key = 'render.owner-access-choice';
export const ownerAccessLabel = choice => OWNER_ACCESS_CHOICES.find(item => item.id === choice)?.label || null;
export function readOwnerAccessChoice(storage) {
  try { const value = storage.getItem(key); return ownerAccessLabel(value) ? value : null; } catch { return null; }
}
export function rememberOwnerAccessChoice(choice, storage) {
  if (!ownerAccessLabel(choice)) return false;
  try { storage.setItem(key, choice); return true; } catch { return false; }
}
