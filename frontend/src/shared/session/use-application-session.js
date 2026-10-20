import { useSyncExternalStore } from 'react';
import { getApplicationSessionSnapshot, subscribeApplicationSession } from './application-session-access.js';

// Runtime/store own the document lifetime. React only subscribes; StrictMode
// cleanup must never dispose the runtime, bootstrap again, or log out the user.
export function useApplicationSession() {
  return useSyncExternalStore(subscribeApplicationSession, getApplicationSessionSnapshot, getApplicationSessionSnapshot);
}
