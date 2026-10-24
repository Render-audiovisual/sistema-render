import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Source contracts only. Native top-layer/focus/StrictMode behavior still needs
// real integration verification; these assertions do not mount React.
const source = readFileSync(new URL('./DiscardChangesDialog.jsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('./DiscardChangesDialog.css', import.meta.url), 'utf8');

test('native modal uses unique accessible labels and safe default action', () => {
  assert.match(source, /const titleId = useId\(\)/);
  assert.match(source, /const descriptionId = useId\(\)/);
  assert.match(source, /<dialog ref=\{dialogRef\}/);
  assert.match(source, /aria-labelledby=\{titleId\} aria-describedby=\{descriptionId\}/);
  assert.match(source, /<h2 id=\{titleId\}>¿Descartar los cambios\?<\/h2>/);
  assert.match(source, /description = 'Los cambios de este borrador no se guardaron/);
  assert.match(source, /<p id=\{descriptionId\}>\{description\}<\/p>/);
  assert.doesNotMatch(source, /dangerouslySetInnerHTML/);
  assert.match(source, /if \(!dialog.isConnected\) throw/);
  assert.match(source, /if \(!dialog.open\) dialog.showModal\(\)/);
  assert.match(source, /ref=\{keepRef\} type="button" autoFocus/);
  assert.match(source, /keepRef.current\?\.focus\(\{ preventScroll: true \}\)/);
});

test('Escape, native cancel and all dialog clicks cannot bubble into TaskDetail backdrop', () => {
  assert.match(source, /onClick=\{event => event.stopPropagation\(\)\}/);
  assert.match(source, /onCancel=\{event => \{ event.preventDefault\(\); event.stopPropagation\(\); finish\(false\); \}\}/);
  assert.match(source, /onKeyDownCapture=[\s\S]*?event.key === 'Escape'[\s\S]*?event.preventDefault\(\); event.stopPropagation\(\); finish\(false\)/);
  assert.match(source, /onKeyUpCapture=\{event => \{ if \(event.key === 'Escape'\) event.stopPropagation\(\)/);
  assert.equal((source.match(/finish\(true\)/g) || []).length, 1, 'Only explicit discard button discards');
});

test('busy blocks discard twice while keep remains allowed; callbacks settle once', () => {
  assert.match(source, /discard && latest.current.busy/);
  assert.match(source, /disabled=\{busy\}/);
  assert.match(source, /if \(!latest.current.busy\) finish\(true\)/);
  assert.match(source, /handledRef.current \|\| !latest.current.open/);
  assert.match(source, /handledRef.current = true/);
  assert.match(source, /autoFocus onClick=\{\(\) => finish\(false\)\}>Seguir editando/);
});

test('external native close keeps editing and modal failure never implies discard', () => {
  assert.match(source, /if \(session.active && !dialog.open\) finish\(false\)/);
  assert.match(source, /dialog.addEventListener\('close', closed\)/);
  assert.match(source, /catch \{[\s\S]*?finish\(false\)/);
});

test('keep restores usable invoker or task panel, discard/unmount never explicitly restore focus', () => {
  assert.match(source, /element\?\.isConnected && !element.disabled/);
  assert.match(source, /!element.matches\?\.\(':disabled'\)/);
  assert.match(source, /!element.closest\?\.\('\[inert\]'\)/);
  assert.match(source, /if \(usable\(session.invoker\)\) session.invoker.focus/);
  assert.match(source, /querySelector\('\.ros-task-workspace\[role="dialog"\]'\)/);
  assert.match(source, /if \(usable\(panel\)\) panel.focus/);
  const discard = source.match(/if \(discard\) \{([\s\S]*?)\n    \}/)?.[1];
  assert.ok(discard); assert.match(discard, /onDiscard\?\.\(\)/);
  assert.doesNotMatch(discard, /\.focus\(|\.close\(/);
  const cleanup = source.match(/return \(\) => \{([\s\S]*?)\n    \};/)?.[1];
  assert.ok(cleanup);
  assert.match(cleanup, /session.active = false/);
  assert.match(cleanup, /removeEventListener\('close', closed\)/);
  assert.doesNotMatch(cleanup, /\.focus\(|finish\(|onKeepEditing\?\.|onDiscard\?\.|showModal\(/);
});

test('lifecycle does not depend on changing callbacks, mutate global inert or replace navigation', () => {
  assert.match(source, /\}, \[open\]\)/);
  assert.match(source, /latest.current = \{ open, busy, onKeepEditing, onDiscard \}/);
  assert.doesNotMatch(source, /window\.confirm|createPortal|document\.body|\.inert\s*=|setAttribute\(|history\.|fetch\(/);
});

test('styles are scoped and token-based with mobile bounds, 44px controls and focus', () => {
  const rules = css.match(/[^{}]+(?=\{)/g) || [];
  for (const rule of rules) {
    if (rule.trim().startsWith('@')) continue;
    for (const selector of rule.split(',')) assert.match(selector.trim(), /^\.render-discard-dialog(?:\b|[\s.:])/);
  }
  for (const token of ['surface', 'ink', 'font', 'line', 'accent', 'accent-ink', 'danger']) assert.ok(css.includes(`var(--render-${token})`));
  assert.match(css, /max-height: calc\(100dvh - 32px\)/);
  assert.match(css, /min-height: 44px/);
  assert.match(css, /outline: 2px solid var\(--render-accent\)/);
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.doesNotMatch(css, /!important|@import|:root|\bbody\s*\{|\bhtml\s*\{/);
});
