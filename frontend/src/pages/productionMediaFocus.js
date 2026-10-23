// One memory-only focus handoff for a submitted media form. The caller owns
// ACK validation and supplies an observation-based (ABA-safe) detail lifetime.
// Never restores on errors, cleanup, a timer or a replacement form/target.
export function captureProductionMediaFocus({ form, target, documentTarget: doc, isCurrent } = {}) {
  let phase = 'cancelled';
  const listeners = [];
  const stop = () => {
    for (const [node, type, listener] of listeners.splice(0)) {
      try { node.removeEventListener(type, listener, true); } catch { /* No focus during cleanup. */ }
    }
  };
  const cancel = () => { phase = 'cancelled'; stop(); };
  const current = () => typeof isCurrent === 'function' && isCurrent() === true
    && doc?.hidden !== true && doc?.visibilityState === 'visible'
    && (typeof doc.hasFocus !== 'function' || doc.hasFocus() === true);
  const visible = node => {
    if (!node || node.nodeType !== 1 || node.isConnected !== true
      || node.closest('[hidden],[inert],[aria-hidden="true"]') || node.getClientRects().length === 0) return false;
    const view = doc.defaultView;
    if (typeof view?.getComputedStyle !== 'function') return false;
    for (let parent = node; parent?.nodeType === 1; parent = parent.parentElement) {
      const style = view.getComputedStyle(parent);
      if (!style || style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse') return false;
    }
    return true;
  };
  const hasModal = () => [...doc.querySelectorAll('dialog[open],[role="dialog"][aria-modal="true"]')].some(visible);
  const usableTarget = ({ allowDisabled = false } = {}) => {
    if (!target || target.nodeType !== 1 || target.tagName !== 'BUTTON' || target.ownerDocument !== doc
      || target.isConnected !== true || (!allowDisabled && target.disabled) || typeof target.focus !== 'function'
      || (!allowDisabled && target.matches(':disabled'))) return false;
    return visible(target);
  };
  try {
    if (current() && form?.nodeType === 1 && form.tagName === 'FORM' && form.ownerDocument === doc
      && form.isConnected === true && doc.activeElement && form.contains(doc.activeElement) && usableTarget() && !hasModal()) {
      phase = 'captured';
      const focusMoved = event => {
        try { if (!current() || (event.target !== doc.body && !form.contains(event.target))) cancel(); }
        catch { cancel(); }
      };
      const visibilityChanged = () => { try { if (!current()) cancel(); } catch { cancel(); } };
      // Capturing on window also receives descendant control blur events.
      // Disabling the submitting button must not look like leaving the window.
      const windowBlurred = event => { if (event.target === doc.defaultView) cancel(); };
      for (const [node, type, listener] of [[doc, 'pointerdown', cancel], [doc, 'keydown', cancel],
        [doc, 'focusin', focusMoved], [doc, 'visibilitychange', visibilityChanged], [doc.defaultView, 'blur', windowBlurred]]) {
        if (phase !== 'captured') break;
        listeners.push([node, type, listener]); node.addEventListener(type, listener, true);
      }
    }
  } catch { cancel(); /* A partial/unsupported DOM never grants a focus transfer. */ }

  const confirm = () => {
    if (phase !== 'captured') return false;
    try {
      // The write's busy=false state may not have committed yet. Confirmation
      // retains the same visible target; only the later layout may focus it,
      // after restore rechecks that it is actually enabled.
      if (!current() || form.isConnected !== true || !usableTarget({ allowDisabled: true }) || hasModal()
        || !(doc.activeElement === doc.body || form.contains(doc.activeElement))) { cancel(); return false; }
      phase = 'confirmed'; return true;
    } catch { cancel(); return false; }
  };
  const restore = () => {
    if (phase !== 'confirmed') return false;
    // Consume before calling any DOM method: even re-entrant focus events or
    // duplicate layout effects cannot transfer focus twice.
    phase = 'consumed';
    stop();
    try {
      const active = doc.activeElement;
      if (!current() || form.isConnected !== false || !usableTarget() || hasModal()
        || !(active === doc.body || (active?.isConnected === false && (active === form || form.contains(active))))) return false;
      target.focus({ preventScroll: true });
      return doc.activeElement === target && current();
    } catch { return false; }
  };
  const dispose = cancel;
  return { confirm, restore, dispose };
}
