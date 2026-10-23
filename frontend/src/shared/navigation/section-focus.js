const MAIN = 'main,[role="main"]';
const LOADING = '.route-loading,[data-render-route-loading]';
const MODAL = 'dialog[open],[role="dialog"][aria-modal="true"]';
const MOBILE_MENU = '.sidebar-menu-toggle[aria-expanded="true"]';
const BLOCKED = 'nav,[role="navigation"],dialog,[role="dialog"],[hidden],[inert],[aria-hidden="true"]';
const INTERACTIVE = 'a[href],button,input,textarea,select,summary,[contenteditable]:not([contenteditable="false"]),[role="button"],[role="link"],[role="textbox"],[tabindex]:not([tabindex="-1"])';
const DECORATION = 'data-render-section-focus-target';
// At most one live decoration per node, even if a retired manager is disposed
// after a replacement has focused the same reused heading.
const ownedDecorations = new WeakMap();

// Match App's pathname routing. Only the actual /clientes management switch is
// a different section; board selection, filters, pagination and hashes are not.
export function sectionFocusKey(path, search = '') {
  const pathname = typeof path === 'string' ? path : '';
  return pathname === '/clientes' && new URLSearchParams(search).get('gestion') === '1'
    ? '/clientes?gestion=1' : pathname;
}

/** One owner/section lifetime. The caller's render-time observation must make
 * isCurrent false immediately on account/route ABA, before effect cleanup.
 * request returns true for accepted focus OR one owner-bound loading observer.
 * observerFactory, when supplied, is callback => MutationObserver-like object.
 */
export function createSectionFocusManager({ documentTarget: doc, windowTarget: win, readMarker, isCurrent, observerFactory }) {
  let disposed = false, pending = null;
  const decorations = new Set();
  const current = () => {
    try { return !disposed && !doc.hidden && doc.visibilityState !== 'hidden' && isCurrent() === true; }
    catch { return false; }
  };
  const visible = node => {
    if (!node || node.nodeType !== 1 || node.isConnected === false) return false;
    if (node.closest('[hidden],[inert],[aria-hidden="true"]')) return false;
    for (let parent = node; parent?.nodeType === 1; parent = parent.parentElement) {
      const style = win.getComputedStyle?.(parent);
      if (style?.display === 'none' || style?.visibility === 'hidden' || style?.visibility === 'collapse') return false;
    }
    return typeof node.getClientRects !== 'function' || node.getClientRects().length > 0;
  };
  const usable = node => visible(node) && !node.closest(BLOCKED) && !node.closest(LOADING);
  const hasOverlay = () => [...doc.querySelectorAll(`${MODAL},${MOBILE_MENU}`)].some(visible);
  const elements = (root, selector) => [...(root.matches(selector) ? [root] : []), ...root.querySelectorAll(selector)];
  const find = () => {
    const marker = readMarker();
    if (!marker || marker.isConnected === false || !marker.parentElement) return null;
    let loading = false;
    for (let sibling = marker.nextElementSibling; sibling; sibling = sibling.nextElementSibling) {
      for (const main of elements(sibling, MAIN)) {
        if (!usable(main)) continue;
        const heading = [...main.querySelectorAll('h1')].find(usable);
        return { marker, main, target: heading ?? main };
      }
      if (elements(sibling, LOADING).some(visible)) loading = true;
    }
    return { marker, loading };
  };
  const restore = record => {
    if (!decorations.delete(record)) return;
    record.target.removeEventListener('blur', record.blur);
    if (ownedDecorations.get(record.target) !== record) return;
    ownedDecorations.delete(record.target);
    if (record.tab && record.target.getAttribute('tabindex') === '-1') record.target.removeAttribute('tabindex');
    if (record.decorated && record.target.getAttribute(DECORATION) === '') record.target.removeAttribute(DECORATION);
  };
  const decorate = target => {
    ownedDecorations.get(target)?.release();
    const record = { target, tab: !target.hasAttribute('tabindex'), decorated: !target.hasAttribute(DECORATION) };
    record.blur = () => restore(record);
    record.release = record.blur;
    if (record.tab) target.setAttribute('tabindex', '-1');
    if (record.decorated) target.setAttribute(DECORATION, '');
    target.addEventListener('blur', record.blur);
    decorations.add(record);
    ownedDecorations.set(target, record);
    return record;
  };
  const stop = intent => {
    if (!intent || intent.stopped) return;
    intent.stopped = true;
    if (pending === intent) pending = null;
    try { intent.observer?.disconnect(); } catch { /* no focus during teardown */ }
    for (const [target, type, listener] of intent.listeners) target.removeEventListener(type, listener, true);
    intent.listeners.length = 0;
  };
  const attempt = intent => {
    if (intent.stopped) return false;
    if (!current() || hasOverlay()) { stop(intent); return false; }
    const found = find();
    if (!found || !current()) { stop(intent); return false; }
    if (!found.target) {
      if (!found.loading) stop(intent);
      return false;
    }
    const active = doc.activeElement;
    if (!intent.explicit && active && found.main.contains(active) && active.matches?.(INTERACTIVE)) {
      stop(intent); return false;
    }
    stop(intent); // Our own focusin cannot cancel/arm another loading intent.
    if (!current() || hasOverlay() || !usable(found.target)) return false;
    for (const previous of [...decorations]) restore(previous);
    const record = decorate(found.target);
    try {
      found.target.focus({ preventScroll: true });
      if (doc.activeElement !== found.target || !current()) { restore(record); return false; }
      if (intent.explicit) found.target.scrollIntoView?.({ block: 'start', behavior: 'auto' });
      return true;
    } catch { restore(record); return false; }
  };
  const request = ({ explicit = false } = {}) => {
    stop(pending);
    if (!current()) return false;
    const intent = { explicit: explicit === true, stopped: false, listeners: [], observer: null };
    pending = intent;
    try {
      if (attempt(intent)) return true;
      if (intent.stopped) return false;
      const cancel = () => stop(intent);
      const onFocus = event => { if (event.target?.matches?.(INTERACTIVE)) cancel(); };
      const onVisibility = () => { if (doc.hidden || doc.visibilityState === 'hidden') cancel(); };
      for (const [target, type, listener] of [[doc, 'pointerdown', cancel], [doc, 'keydown', cancel],
        [doc, 'focusin', onFocus], [win, 'blur', cancel], [doc, 'visibilitychange', onVisibility]]) {
        intent.listeners.push([target, type, listener]); target.addEventListener(type, listener, true);
      }
      const factory = observerFactory ?? (callback => new win.MutationObserver(callback));
      intent.observer = factory(() => {
        try { attempt(intent); } catch { stop(intent); }
      });
      if (!intent.observer || typeof intent.observer.observe !== 'function' || typeof intent.observer.disconnect !== 'function') throw new Error('Observer unavailable');
      if (intent.stopped) { intent.observer.disconnect(); return false; }
      const marker = readMarker();
      if (!marker?.parentElement || !current()) { stop(intent); return false; }
      intent.observer.observe(marker.parentElement, { childList: true, subtree: true, attributes: true,
        attributeFilter: ['class', 'style', 'hidden', 'inert', 'aria-hidden', 'open', 'aria-modal', 'aria-expanded'] });
      if (intent.stopped) return false;
      // No elapsed-time cutoff: a slow lazy chunk still deserves its intended
      // focus if this owner remains current and the user has not interacted.
      return true;
    } catch { stop(intent); return false; }
  };
  const dispose = () => {
    disposed = true; stop(pending);
    for (const record of [...decorations]) restore(record);
  };
  return { request, dispose };
}
