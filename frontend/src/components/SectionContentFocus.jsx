import React, { useLayoutEffect, useRef } from 'react';
import { createSectionFocusManager } from '../shared/navigation/section-focus.js';
import './SectionContentFocus.css';

// Shell-only ownership. No route writes, credentials, draft state or dashboard
// wrapper: App places the hidden marker directly before its content sibling.
export function useSectionContentFocus({ sectionKey, owner, enabled }) {
  const markerRef = useRef(null);
  const observationRef = useRef(null);
  const managerRef = useRef(null);
  if (!observationRef.current || observationRef.current.sectionKey !== sectionKey
    || !Object.is(observationRef.current.owner, owner) || observationRef.current.enabled !== enabled) {
    observationRef.current = { sectionKey, owner, enabled };
  }
  const observation = observationRef.current;
  useLayoutEffect(() => {
    if (!observation.enabled || observationRef.current !== observation) return undefined;
    const lease = { observation, active: true, manager: null };
    const isCurrent = () => lease.active && observationRef.current === observation;
    const manager = createSectionFocusManager({ documentTarget: document, windowTarget: window,
      readMarker: () => markerRef.current, isCurrent });
    lease.manager = manager;
    managerRef.current = lease;
    manager.request();
    return () => {
      lease.active = false;
      manager.dispose();
      if (managerRef.current === lease) managerRef.current = null;
    };
  }, [observation]);

  const skip = event => {
    if (event.defaultPrevented || (event.button !== undefined && event.button !== 0)
      || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    // A retained click may belong to a removed section. Suppress its fragment
    // default too, but never let it borrow the replacement manager's ownership.
    event.preventDefault();
    const lease = managerRef.current;
    if (!observation.enabled || observationRef.current !== observation || !lease?.active || lease.observation !== observation) return;
    lease.manager.request({ explicit: true });
  };
  return {
    skipLink: enabled ? <a className="render-section-skip-link" href="#render-main-content" onClick={skip}>Ir al contenido</a> : null,
    marker: enabled ? <span id="render-main-content" ref={markerRef} hidden aria-hidden="true" /> : null,
  };
}
