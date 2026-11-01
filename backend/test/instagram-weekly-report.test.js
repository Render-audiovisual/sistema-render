import test from 'node:test';
import assert from 'node:assert/strict';
import { lastCompleteWeek, resolveAiConfig, buildWeeklyFacts, SYSTEM_PROMPT } from '../src/instagram-weekly-report.js';

test('lastCompleteWeek uses Córdoba Monday-Sunday weeks', () => {
  assert.deepEqual(lastCompleteWeek(new Date('2026-11-02T12:00:00Z')), { desde: '2026-10-26', hasta: '2026-11-01' }); // lunes
  assert.deepEqual(lastCompleteWeek(new Date('2026-11-02T02:00:00Z')), { desde: '2026-10-19', hasta: '2026-10-25' }); // domingo 23h en Córdoba
  assert.deepEqual(lastCompleteWeek(new Date('2026-11-01T15:00:00Z')), { desde: '2026-10-19', hasta: '2026-10-25' });
});

test('AI is off unless explicitly enabled with key and model', () => {
  assert.equal(resolveAiConfig({}), null);
  assert.equal(resolveAiConfig({ ANTHROPIC_API_KEY: 'sk-ant-xxxxxxxxxxxxxxxxxxxx', INSTAGRAM_AI_MODEL: 'm-1' }), null);
  assert.throws(() => resolveAiConfig({ INSTAGRAM_AI_REPORTS_ENABLED: 'true', ANTHROPIC_API_KEY: 'sk-ant-xxxxxxxxxxxxxxxxxxxx' }));
  assert.deepEqual({ ...resolveAiConfig({ INSTAGRAM_AI_REPORTS_ENABLED: 'true', ANTHROPIC_API_KEY: 'sk-ant-xxxxxxxxxxxxxxxxxxxx', INSTAGRAM_AI_MODEL: 'model-x' }) },
    { key: 'sk-ant-xxxxxxxxxxxxxxxxxxxx', model: 'model-x' });
  assert.match(SYSTEM_PROMPT, /No inventes/);
});

test('buildWeeklyFacts compares with the 4-week base and lists clients without posts', () => {
  const row = (clave, cliente, tipo, alcance, extra = {}) => ({ clave, cliente, tipo, alcance, medido_at: new Date(), interacciones: alcance / 10,
    fecha: '2026-10-20', hora: '21', caption: 'texto', permalink: 'https://www.instagram.com/p/x/', ...extra });
  const facts = buildWeeklyFacts({
    week: { desde: '2026-10-19', hasta: '2026-10-25' }, now: new Date('2026-10-28T12:00:00Z'),
    weekRows: [row('cliente-1', 'A', 'reel', 300, { responsable_diseno: 'Luciano' }), row('cliente-1', 'A', 'carrusel', 100)],
    baseRows: [row('cliente-1', 'A', 'reel', 100), row('cliente-1', 'A', 'reel', 100), row('cliente-2', 'B', 'reel', 50)],
    formatRows: [row('cliente-1', 'A', 'reel', 300), row('cliente-1', 'A', 'carrusel', 100)],
    quota: [{ clave: 'cliente-1', reels: 4, carruseles: 4, publicadas: 5 }, { clave: 'cliente-2', reels: 2, carruseles: 2, publicadas: 1 }],
  });
  const a = facts.clientes.find(c => c.cliente === 'A');
  assert.equal(a.alcance_promedio, 200);
  assert.equal(a.variacion_alcance_promedio_pct, 100);
  assert.equal(a.mejor_pieza.alcance, 300);
  assert.deepEqual(a.cupo_mes, { publicadas: 5, cupo: 8 });
  assert.deepEqual(facts.sin_publicar_en_la_semana, ['B']);
  assert.equal(facts.equipo[0].nombre, 'Luciano');
  assert.equal(facts.top_piezas[0].alcance, 300);
});
