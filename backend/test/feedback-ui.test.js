import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { resolveFeedbackClient } from "../../frontend/src/features/render-os/utils/feedback-client.js";

const feedbackSource = readFileSync(new URL("../../frontend/src/pages/Feedback.jsx", import.meta.url), "utf8");
const feedbackStyles = readFileSync(new URL("../../frontend/src/pages/Feedback.css", import.meta.url), "utf8");
const feedbackClientSource = readFileSync(new URL("../../frontend/src/features/render-os/utils/feedback-client.js", import.meta.url), "utf8");

test("Feedback separa las notas del equipo de las notas de clientes", () => {
  assert.match(feedbackSource, /isClientFeedback/);
  assert.match(feedbackSource, /resolveFeedbackClient/);
  assert.match(feedbackSource, /aria-label="Tipo de feedback"/);
  assert.match(feedbackSource, />Equipo</);
  assert.match(feedbackSource, />Clientes</);
  assert.match(feedbackSource, /section === "clients" \? belongsToClients : !belongsToClients/);
  assert.match(feedbackClientSource, /matches\.length === 1 \? matches\[0\] : ""/);
  assert.match(feedbackSource, /note\.creado_por/);
});

test("Feedback recupera el cliente de notas antiguas sin metadata", () => {
  const clients = ["Búnker Training", "Litoral Maq", "Lavalle Market"];
  assert.equal(resolveFeedbackClient({ titulo: "Correcciones BUNKER - Federico", feedback: {} }, clients), "Búnker Training");
  assert.equal(resolveFeedbackClient({ titulo: "Litoral - revisión de piezas", feedback: {} }, clients), "Litoral Maq");
  assert.equal(resolveFeedbackClient({ titulo: "Reunión semanal del equipo", feedback: {} }, clients), "");
  assert.equal(resolveFeedbackClient({ titulo: "Nota general", feedback: { cliente: "Moketa" } }, clients), "Moketa");
});

test("Feedback incorpora pedidos cargados por Wilson como tareas", () => {
  assert.match(feedbackSource, /q=feedback/);
  assert.match(feedbackSource, /task\.propiedades_extra\?\.wilson_confirmado_por/);
  assert.match(feedbackSource, /source: "task"/);
  assert.match(feedbackSource, /Abrir tarea relacionada/);
  assert.match(feedbackSource, /window\.dispatchEvent\(new PopStateEvent\("popstate"\)\)/);
});

test("Feedback presenta resúmenes compactos y abre el contenido en un panel", () => {
  assert.match(feedbackSource, /className="rf-note-card"/);
  assert.match(feedbackSource, /onClick=\{\(\) => openNote\(note\)\}/);
  assert.match(feedbackSource, /className="rf-detail-content"/);
  assert.match(feedbackSource, /role="dialog" aria-modal="true"/);
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

test("Tareas abre Feedback sin recargar ni romper el marco de la aplicación", () => {
  const appSource = readFileSync(new URL("../../frontend/src/App.jsx", import.meta.url), "utf8");
  const workspaceSource = readFileSync(new URL("../../frontend/src/pages/WorkspaceReadOnly.jsx", import.meta.url), "utf8");
  const workspaceStyles = readFileSync(new URL("../../frontend/src/pages/WorkspaceReadOnly.css", import.meta.url), "utf8");
  assert.match(appSource, /window\.addEventListener\("popstate", syncPath\)/);
  assert.match(workspaceSource, /window\.history\.pushState\(\{\}, "", "\/feedback"\)/);
  assert.match(workspaceSource, /onClick=\{openFeedback\}/);
  assert.match(feedbackStyles, /animation:rf-page-enter/);
  assert.match(feedbackStyles, /button:not\(:disabled\):active\{transform:scale\(\.975\)\}/);
  assert.match(workspaceStyles, /animation:ros-surface-enter/);
  assert.match(workspaceStyles, /button:not\(:disabled\):active\{filter:brightness\(\.98\);transform:none\}/);
  assert.match(feedbackStyles, /prefers-reduced-motion:reduce/);
  assert.match(workspaceStyles, /prefers-reduced-motion:reduce/);
});
