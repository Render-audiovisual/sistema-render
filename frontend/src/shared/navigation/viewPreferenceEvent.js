// Notification only: never modifies history or dispatches popstate.
export function notifyViewPreferenceChange(win) {
  try {
    const EventType = win.CustomEvent || win.Event;
    if (typeof EventType !== 'function' || typeof win.dispatchEvent !== 'function') return false;
    win.dispatchEvent(new EventType('render:view-preference-change'));
    return true;
  } catch { return false; }
}
