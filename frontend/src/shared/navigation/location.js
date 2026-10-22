import { withNavigationConsent, dispatchNavigationEvent } from './unsaved.js';
// One notification protocol for principal SPA navigation. Not an authorization layer.
export function readRouteKey(win) {
  return `${win.location.pathname}${win.location.search}${win.location.hash}`;
}

function navigationTarget(win, href) {
  if (typeof href !== "string" || !href.trim()) return false;
  let next;
  try { next = new URL(href, win.location.href); } catch { return false; }
  if (!["http:", "https:"].includes(next.protocol) || next.origin !== win.location.origin
      || next.username || next.password || next.href === win.location.href) return false;
  const target = `${next.pathname}${next.search}${next.hash}`;
  return target;
}

export function requestAppNavigation(win, href) {
  const target = navigationTarget(win, href);
  if (!target) return false;
  const before = new win.CustomEvent("render:before-navigation", { detail: { href: target }, cancelable: true });
  return dispatchNavigationEvent(win, before);
}

function commitNavigation(win, target, validate = () => true) {
  if (!requestAppNavigation(win, target) || !validate()) return false;
  win.history.pushState({}, "", target);
  win.dispatchEvent(new win.PopStateEvent("popstate", { state: win.history.state }));
  win.scrollTo({ top: 0, behavior: "auto" });
  return true;
}

export function navigateWithinApp(win, href) {
  const target = navigationTarget(win, href);
  return target ? commitNavigation(win, target) : false;
}

export function navigateWithConfirmation(win, href, { present, isCurrent } = {}) {
  const target = navigationTarget(win, href);
  if (!target) return Promise.resolve(false);
  return withNavigationConsent(win, target, { present, isCurrent,
    perform: validate => commitNavigation(win, target, validate) });
}
