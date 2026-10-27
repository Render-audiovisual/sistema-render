import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { resolveFeedbackClient } from "../../frontend/src/features/render-os/utils/feedback-client.js";

const feedbackSource = readFileSync(new URL("../../frontend/src/pages/Feedback.jsx", import.meta.url), "utf8");
const feedbackStyles = readFileSync(new URL("../../frontend/src/pages/Feedback.css", import.meta.url), "utf8");
const feedbackClientSource = readFileSync(new URL("../../frontend/src/features/render-os/utils/feedback-client.js", import.meta.url), "utf8");
const sharedClientSource = readFileSync(new URL('../../shared/feedback-client.mjs', import.meta.url), 'utf8');
const notesReadSource = readFileSync(new URL('../src/feedback-notes-read.js', import.meta.url), 'utf8');

test("Feedback separa las notas del equipo de las notas de clientes", () => {
  assert.match(feedbackSource, /selected\.section|selected\?\.section/);
  assert.match(feedbackSource, /resolved_client/);
  assert.match(feedbackSource, /aria-label="Tipo de feedback"/);
  assert.match(feedbackSource, />Equipo</);
  assert.match(feedbackSource, />Clientes</);
  assert.match(feedbackSource, /const visible = notes/);
  assert.match(notesReadSource, /context.section!=='all'&&item.section!==context.section/);
  assert.match(feedbackClientSource, /shared\/feedback-client\.mjs/);
  assert.match(sharedClientSource, /matches.length === 1 \? matches\[0\] : ''/);
  assert.match(feedbackSource, /selected\.creado_por/);
});

test("Feedback recupera el cliente de notas antiguas sin metadata", () => {
  const clients = ["Búnker Training", "Litoral Maq", "Lavalle Market"];
  assert.equal(resolveFeedbackClient({ titulo: "Correcciones BUNKER - Federico", feedback: {} }, clients), "Búnker Training");
  assert.equal(resolveFeedbackClient({ titulo: "Litoral - revisión de piezas", feedback: {} }, clients), "Litoral Maq");
  assert.equal(resolveFeedbackClient({ titulo: "Reunión semanal del equipo", feedback: {} }, clients), "");
  assert.equal(resolveFeedbackClient({ titulo: "Nota general", feedback: { cliente: "Moketa" } }, clients), "Moketa");
});

test("Feedback distingue notas compartidas del inventario real de revisión de edición", () => {
  assert.match(feedbackSource, /<FeedbackTaskInventory request=\{transport\} sesion=\{sesion\} clients=\{clients\}/);
  assert.doesNotMatch(feedbackSource, /q=feedback|source: "task"|setTaskFeedbacks/);
  assert.match(feedbackSource, /const visible = notes/);
  assert.match(feedbackSource, /createFeedbackNotesReader/);
});

test("Feedback presenta resúmenes compactos y abre el contenido en un panel", () => {
  assert.match(feedbackSource, /className="rf-note-card"/);
  assert.match(feedbackSource, /onClick=\{\(\) => openNote\(note\)\}/);
  assert.match(feedbackSource, /className="rf-detail-content"/);
  assert.match(feedbackSource, /<Modal native onClose=\{closePanel\}/);
  const modalSource = readFileSync(new URL('../../frontend/src/components/Modal.jsx', import.meta.url), 'utf8');
  assert.match(modalSource, /role="dialog"/);
  assert.match(modalSource, /aria-modal="true"/);
  assert.match(feedbackSource, /aria-label="Buscar feedback"/);
  assert.doesNotMatch(feedbackSource, /Filtrar por cliente|rf-client-filter/);
});

test("Feedback adapta la grilla y el detalle a pantallas móviles", () => {
  assert.match(feedbackStyles, /@media\(max-width:720px\)/);
  assert.match(feedbackStyles, /\.rf-grid\{grid-template-columns:1fr\}/);
  assert.match(feedbackStyles, /\.rf-panel\{height:100dvh;max-width:none;width:100%\}/);
  assert.match(feedbackStyles, /min-height:44px/);
  assert.match(feedbackStyles, /env\(safe-area-inset-top\)/);
  assert.match(feedbackStyles, /\.rf-search input\{font-size:16px/);
  assert.match(feedbackStyles, /\.rf-panel-backdrop\{z-index:1300\}/);
  assert.match(feedbackStyles, /position:sticky/);
  assert.match(feedbackStyles, /overscroll-behavior-y:contain/);
});

test("Tareas elimina su shortcut de Feedback; la página dedicada y su retorno seguro permanecen", () => {
  const appSource = readFileSync(new URL("../../frontend/src/App.jsx", import.meta.url), "utf8");
  const workspaceSource = readFileSync(new URL("../../frontend/src/pages/WorkspaceReadOnly.jsx", import.meta.url), "utf8");
  const workspaceStyles = readFileSync(new URL("../../frontend/src/pages/WorkspaceReadOnly.css", import.meta.url), "utf8");
  assert.match(appSource, /window\.addEventListener\("popstate", syncPath\)/);
  assert.doesNotMatch(workspaceSource, /const openFeedback|onClick=\{openFeedback\}|newFeedbackCount|refreshFeedbackCount/);
  assert.doesNotMatch(workspaceSource, /<button className=\{`ros-feedback-link/);
  assert.match(appSource, /path === "\/feedback"/);
  assert.match(appSource, /return <FeedbackPage sesion=\{sesion\}/);
  const navigation = readFileSync(new URL('../../frontend/src/components/navigation.js', import.meta.url), 'utf8');
  assert.match(navigation, /\/feedback/);
  assert.match(feedbackSource, /← Volver a tareas/);
  assert.match(feedbackSource, /window\.history\.state\?\.fromTasks/);
  assert.match(feedbackSource, /return navigateWithinApp\(window, `\$\{origin.pathname\}\$\{origin.search\}\$\{origin.hash\}`\)/);
  assert.match(feedbackSource, /return navigateWithinApp\(window, "\/workspace\/tareas"\)/);
  assert.match(feedbackStyles, /animation:rf-page-enter/);
  assert.match(feedbackStyles, /button:not\(:disabled\):active\{transform:scale\(\.975\)\}/);
  assert.match(workspaceStyles, /animation:ros-surface-enter/);
  assert.match(workspaceStyles, /button:not\(:disabled\):active\{filter:brightness\(\.98\);transform:none\}/);
  assert.match(feedbackStyles, /prefers-reduced-motion:reduce/);
  assert.match(workspaceStyles, /prefers-reduced-motion:reduce/);
});
