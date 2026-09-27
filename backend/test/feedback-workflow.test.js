import assert from "node:assert/strict";
import test from "node:test";
import { feedbackSimilarity, findSimilarFeedback } from "../src/feedback-workflow.js";

test("detects similar feedback only for the same client", () => {
  const notes = [
    { id: 1, titulo: "Cambiar portada del carrusel", contenido: "No usar fondo rojo", feedback: { cliente: "Bunker", estado: "pendiente" } },
    { id: 2, titulo: "Cambiar portada del carrusel", contenido: "No usar fondo rojo", feedback: { cliente: "Luzin" } },
  ];
  const matches = findSimilarFeedback({ cliente: "Búnker", titulo: "Cambiar la portada del carrusel", contenido: "Evitar fondo rojo" }, notes);
  assert.deepEqual(matches.map((item) => item.id), [1]);
});

test("similarity ignores accents and punctuation", () => {
  assert.ok(feedbackSimilarity("Corrección de edición", "correccion edicion") > 0.9);
});
