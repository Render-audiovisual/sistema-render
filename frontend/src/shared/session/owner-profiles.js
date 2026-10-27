const keys = ['franco', 'agustin'];
const positive = value => Number.isSafeInteger(value) && value > 0;
const exact = (value, fields) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === fields.length && fields.every(field => Object.hasOwn(value, field));
const invalid = () => new Error('Capacidad de perfiles inválida.');

// Only server session DTO metadata supplies capability, mapping and labels.
// No names, roles, storage values or synthetic IDs can enable this feature.
export function parseOwnerProfiles(value, actorId) {
  if (!exact(value, ['principal_id', 'active', 'profiles']) || !positive(value.principal_id)
    || value.active !== null && !keys.includes(value.active) || !Array.isArray(value.profiles) || value.profiles.length !== 2) throw invalid();
  const seen = new Set(), ids = new Set();
  const profiles = value.profiles.map(profile => {
    if (!exact(profile, ['key', 'user_id', 'name']) || !keys.includes(profile.key) || seen.has(profile.key)
      || !positive(profile.user_id) || profile.user_id === value.principal_id || ids.has(profile.user_id)
      || typeof profile.name !== 'string' || !profile.name.trim() || profile.name.length > 256
      || /[\u0000-\u001f\u007f-\u009f]/.test(profile.name)) throw invalid();
    seen.add(profile.key); ids.add(profile.user_id);
    return Object.freeze({ key: profile.key, user_id: profile.user_id, name: profile.name });
  });
  const active = profiles.find(profile => profile.key === value.active);
  if (actorId !== (value.active === null ? value.principal_id : active?.user_id)) throw invalid();
  return Object.freeze({ principal_id: value.principal_id, active: value.active, profiles: Object.freeze(profiles) });
}

export function ownerProfileCapability(session) {
  if (!session || Object.hasOwn(session, 'token') || typeof session.session_context !== 'string') return null;
  try { return session.owner_profiles === undefined ? null : parseOwnerProfiles(session.owner_profiles, session.usuario?.id); }
  catch { return null; }
}
export function activeOwnerProfileLabel(session) {
  const capability = ownerProfileCapability(session);
  if (!capability) return null;
  return capability.active === null ? 'Cuenta Render · perfil principal' :
    `Cuenta Render · perfil activo: ${capability.profiles.find(profile => profile.key === capability.active).name}`;
}
