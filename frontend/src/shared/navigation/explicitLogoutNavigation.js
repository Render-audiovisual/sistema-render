// Document-local presentation intent, never evidence of server revocation.
// Observe the store synchronously: a render can miss an intervening B session.
export function createExplicitLogoutNavigation({ readSnapshot, subscribe }) {
  let attempt = null;
  function clear(expected = attempt) {
    if (!expected || attempt !== expected) return;
    attempt = null;
    expected.unsubscribe?.();
    expected.unsubscribe = null;
  }
  function observe(held) {
    if (attempt !== held) return;
    let live;
    try { live = readSnapshot(); } catch { clear(held); return; }
    if (live === held.original || live === held.withdrawn) return;
    if (!held.withdrawn && live?.status === 'anonymous' && live.session === null) {
      held.withdrawn = live;
    } else clear(held);
  }
  return Object.freeze({
    run(original, work) {
      try {
        if (attempt?.pending || readSnapshot() !== original || original?.status !== 'authenticated' || !original.session) return Promise.resolve(false);
        clear();
        const held = { original, withdrawn: null, pending: true, unsubscribe: null };
        attempt = held;
        try {
          held.unsubscribe = subscribe(() => observe(held));
          // Subscribing must not let a changed identity reach the logout call.
          if (attempt !== held || readSnapshot() !== original) { clear(held); held.unsubscribe?.(); return Promise.resolve(false); }
          const result = work();
          return Promise.resolve(result).then(value => {
            observe(held);
            held.pending = false;
            held.unsubscribe?.(); held.unsubscribe = null;
            if (!held.withdrawn) clear(held);
            return value;
          }, () => { clear(held); return false; });
        } catch { clear(held); return Promise.resolve(false); }
      } catch { return Promise.resolve(false); }
    },
    destination(snapshot) {
      const held = attempt;
      if (!held) return null;
      observe(held);
      return attempt === held && held.withdrawn && held.withdrawn === snapshot ? '/login' : null;
    },
    clear: () => clear(),
  });
}
