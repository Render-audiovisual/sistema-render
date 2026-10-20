// Pure public contract shared by the browser and server. Never trim, normalize
// or return a password; callers retain the exact value supplied by the person.
export const PASSWORD_POLICY_MESSAGE = 'La contraseña debe tener al menos 12 caracteres y no superar 72 bytes UTF-8.';
export function newPasswordError(value) {
  if (typeof value !== 'string' || value.length > 72 || !value.trim() || value.includes('\0')) return PASSWORD_POLICY_MESSAGE;
  const points = [...value];
  if (points.length < 12 || points.some(point => { const code=point.codePointAt(0); return code>=0xd800 && code<=0xdfff; })
    || new TextEncoder().encode(value).length > 72) return PASSWORD_POLICY_MESSAGE;
  return null;
}
