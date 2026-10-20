import { useMemo } from 'react';
import { createSessionView, sessionViewInputs } from './session-view.js';

export function useSessionView(session) {
  const { key, cookieSession, id, role, active, token } = sessionViewInputs(session);
  // Complete primitive dependencies for legacy getSesion() clones, exact DTO
  // dependency for cookie observations. No request or subscription during render.
  return useMemo(() => createSessionView({ key, cookieSession, id, role, active, token }),
    [key, cookieSession, id, role, active, token]);
}
