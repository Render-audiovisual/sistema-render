import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { normalizePublicationDispatch } from "../src/publication-dispatch.js";

const base = {
  clientId: 8,
  publicationId: 42,
  type: "reel",
  caption: "Un nuevo reel",
  materials: ["https://drive.google.com/file/d/video"],
  platforms: ["instagram", "facebook"],
  scheduledAt: "2026-09-30T12:00:00.000Z",
  requestKey: "987b3c98-4764-4cd3-a6e4-a4290c8dc087",
};

test("normaliza un envío de prueba para una o ambas plataformas", () => {
  const payload = normalizePublicationDispatch(base);
  assert.equal(payload.status, "programada");
  assert.deepEqual(payload.platforms, ["instagram", "facebook"]);
  assert.equal(payload.materials.length, 1);
  assert.equal(payload.options.source, "render_publications_preview");

  const immediate = normalizePublicationDispatch({ ...base, mode: "now", platforms: { instagram: true } });
  assert.equal(immediate.status, "lista_para_publicar");
  assert.deepEqual(immediate.platforms, ["instagram"]);
});

test("rechaza publicaciones incompletas antes de consultar la base", () => {
  assert.throws(() => normalizePublicationDispatch({ ...base, clientId: null }), /cliente válido/);
  assert.throws(() => normalizePublicationDispatch({ ...base, caption: "" }), /copy/);
  assert.throws(() => normalizePublicationDispatch({ ...base, platforms: [] }), /plataforma/);
  assert.throws(() => normalizePublicationDispatch({ ...base, materials: [] }), /material/);
  assert.throws(() => normalizePublicationDispatch({ ...base, scheduledAt: "ayer" }), /fecha y hora/);
});

test("valida la cantidad de materiales de Reels y carruseles", () => {
  assert.throws(
    () => normalizePublicationDispatch({ ...base, materials: [base.materials[0], "https://drive.google.com/file/d/otro"] }),
    /un solo video/,
  );
  assert.throws(
    () => normalizePublicationDispatch({ ...base, type: "carrusel" }),
    /entre 2 y 10 piezas/,
  );
  const carousel = normalizePublicationDispatch({
    ...base,
    type: "carrusel",
    materials: ["https://drive.google.com/file/d/1", "https://drive.google.com/file/d/2"],
  });
  assert.equal(carousel.materials.length, 2);
});

test("la API exige community o Líder y mantiene el modo preview", () => {
  const source = readFileSync(new URL("../src/publication-dispatch.js", import.meta.url), "utf8");
  const migration = readFileSync(new URL("../migrations/037_publicacion_envios.sql", import.meta.url), "utf8");
  assert.match(source, /requireRole\("admin", "community"\)/);
  assert.match(source, /error\.code === "23505"/);
  assert.match(source, /preview_only\)\s*VALUES[\s\S]*TRUE/);
  assert.doesNotMatch(source, /graph\.facebook\.com|graph\.instagram\.com/);
  assert.match(migration, /idempotency_key TEXT NOT NULL UNIQUE/);
  assert.match(migration, /UNIQUE \(envio_id, plataforma\)/);
});
