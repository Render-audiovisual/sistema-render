const UNINSTALLED = Object.freeze({ status: 'error', session: null, revision: 0 });

// Document-local wiring only, never identity verification. The server remains
// authoritative; do not import main.jsx from consumers or create a second runtime.
export function createApplicationSessionAccess() {
  let runtime = null;
  return Object.freeze({
    install(value) {
      if (runtime) {
        if (runtime !== value) throw new Error('El runtime de sesión ya está instalado.');
        return runtime;
      }
      if (!value || !Object.isFrozen(value) || !['bearer', 'browser'].includes(value.mode)
        || !['getSession', 'getSnapshot', 'subscribe', 'start', 'fetch', 'login', 'logout', 'dispose']
          .every(key => typeof value[key] === 'function')) throw new Error('Runtime de sesión inválido.');
      runtime = value;
      return runtime;
    },
    get: () => runtime,
    getSnapshot: () => runtime ? runtime.getSnapshot() : UNINSTALLED,
    subscribe: listener => runtime ? runtime.subscribe(listener) : () => {},
  });
}

const access = createApplicationSessionAccess();
export const installApplicationSession = access.install;
export const getApplicationSession = access.get;
export const getApplicationSessionSnapshot = access.getSnapshot;
export const subscribeApplicationSession = access.subscribe;
