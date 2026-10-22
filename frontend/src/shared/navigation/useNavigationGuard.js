import { useEffect, useRef } from 'react';
import { registerNavigationGuard } from './unsaved.js';

export function useNavigationGuard(getStatus, readObservation) {
  const latest = useRef(getStatus);
  latest.current = getStatus;
  latest.readObservation = readObservation;
  // A render observes a new form snapshot even when the status stays dirty.
  // Opaque identity only: no draft text, credentials or business persistence.
  latest.observation = Symbol('navigation-form-render');
  useEffect(() => registerNavigationGuard(window, context => latest.current(context), {
    readObservation: () => {
      if (latest.readObservation === undefined) return latest.observation;
      if (typeof latest.readObservation !== 'function') throw new TypeError('La observación necesita un lector.');
      const external = latest.readObservation();
      if (!latest.signature || latest.signature.render !== latest.observation || !Object.is(latest.signature.external, external)) {
        latest.signature = { render: latest.observation, external, token: Symbol('navigation-form-observation') };
      }
      return latest.signature.token;
    },
  }), []);
}
