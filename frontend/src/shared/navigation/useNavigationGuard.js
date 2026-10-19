import { useEffect, useRef } from 'react';
import { registerNavigationGuard } from './unsaved.js';

export function useNavigationGuard(getStatus) {
  const latest = useRef(getStatus);
  latest.current = getStatus;
  useEffect(() => registerNavigationGuard(window, context => latest.current(context)), []);
}
