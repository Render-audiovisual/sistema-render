import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const server = readFileSync(new URL("../src/server.js", import.meta.url), "utf8");

const ADMIN_ONLY_CONTENT_ROUTES = [
  ["post", "/estructura"],
  ["post", "/check-publicacion"],
  ["patch", "/fechas-especiales/:id"],
  ["patch", "/historias/:id"],
  ["delete", "/historias/:id"],
  ["patch", "/publicaciones/:id"],
  ["delete", "/publicaciones/:id"],
  ["post", "/piezas"],
  ["post", "/historias/convertir-flyer/:publicacionId"],
  ["patch", "/piezas/:id"],
];

test("las mutaciones de contenido histórico exigen rol administrador", () => {
  for (const [method, path] of ADMIN_ONLY_CONTENT_ROUTES) {
    const escapedPath = path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    assert.match(
      server,
      new RegExp(`router\\.${method}\\("${escapedPath}", requireRole\\("admin"\\)`),
      `${method.toUpperCase()} ${path} debe validar el rol en el backend`,
    );
  }
});
