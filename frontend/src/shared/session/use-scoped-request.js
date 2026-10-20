import { useCallback, useLayoutEffect, useRef } from 'react';
import { getSesion } from '../../utils.jsx';
import { apiRequest } from '../../features/render-os/services/render-os-api.js';
import { createCapturedRequest } from './captured-request.js';
import { useSessionView } from './use-session-view.js';

// Retain the genuine session and the exact context observation, including ABA.
// Context is a stable primitive supplied by the caller, never an auth grant.
export function useScopedRequest(sesion, context = null) {
  const view = useSessionView(sesion || getSesion());
  const live = useRef({ view, context, epoch: 0 });
  if (live.current.view !== view || live.current.context !== context) {
    live.current = { view, context, epoch: live.current.epoch + 1 };
  }
  const observation = live.current;
  const mounted = useRef(false);
  useLayoutEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const capture = useCallback(() => createCapturedRequest({ session: view.session, readSession: getSesion, request: apiRequest,
    isActive: () => mounted.current && live.current === observation }), [view, observation]);
  const captureLifetime = useCallback(() => createCapturedRequest({ session: view.session, readSession: getSesion, request: apiRequest,
    isActive: () => mounted.current && live.current.view === view }), [view]);
  return { view, capture, captureLifetime, epoch: observation.epoch };
}
