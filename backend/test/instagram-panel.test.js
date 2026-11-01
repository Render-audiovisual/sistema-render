import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPanel, panelPeriod, previousPeriod, interactions, responsablesDe, finishTotals } from '../src/instagram-panel.js';

test('panelPeriod accepts only one YYYY-MM value', () => {
  assert.equal(panelPeriod({ periodo: '2026-10' }), '2026-10');
  for (const query of [{}, { periodo: '2026-13' }, { periodo: ['2026-10'] }, { periodo: '2026-10', x: '1' }, { periodo: '26-10' }])
    assert.throws(() => panelPeriod(query), { status: 400 });
  assert.equal(previousPeriod('2026-01'), '2025-12');
});

test('interactions falls back to the sum of parts and responsables are unique', () => {
  assert.equal(interactions({ interacciones: 9 }), 9);
  assert.equal(interactions({ interacciones: null, likes: 3, comentarios: 1, guardados: null, compartidos: 2 }), 6);
  assert.equal(interactions({}), null);
  assert.deepEqual(responsablesDe({ responsables_objetivo: ['Mariano', 'Augusto'], responsable_diseno: 'Augusto', responsable_edicion: ' ' }), ['Augusto', 'Mariano']);
  assert.equal(finishTotals({ ...finishTotals({ piezas: 0, medidas: 0, alcance: 0, vistas: 0, interacciones: 0 }) }).tasa_interaccion, null);
});

test('buildPanel groups shared feeds, compares months and credits people', () => {
  const clients = [
    { id: 1, nombre: 'Bohle', clave: 'cliente-1' },
    { id: 2, nombre: 'Lavalle H', grupo_nombre: 'Lavalle', clave: 'grupo-9' },
    { id: 3, nombre: 'Lavalle M', grupo_nombre: 'Lavalle', clave: 'grupo-9' },
    { id: 4, nombre: 'Sin nada', clave: 'cliente-4' },
  ];
  const accounts = [
    { ig_user_id: '10', username: 'bohle', cliente_id: 1, activa: true, sincronizada_at: new Date('2026-10-30T10:00:00Z') },
    { ig_user_id: '20', username: 'lavh', cliente_id: 2, activa: true, sincronizada_at: new Date('2026-10-31T10:00:00Z') },
    { ig_user_id: '30', username: 'lavm', cliente_id: 3, activa: true, sincronizada_at: null },
    { ig_user_id: '40', username: 'suelta', cliente_id: null, activa: true, sincronizada_at: null },
  ];
  const m = (id, user, tipo, periodo, alcance, extra = {}) => ({ ig_media_id: id, ig_user_id: user, tipo, periodo, alcance, vistas: alcance * 2,
    interacciones: alcance / 10, guardados: 1, compartidos: 0, medido_at: new Date(), vinculo: 'automatico', ...extra });
  const media = [
    m('1', '10', 'reel', '2026-10', 1000, { responsable_diseno: 'Augusto' }),
    m('2', '10', 'carrusel', '2026-10', 500, { vinculo: 'ambiguo' }),
    m('3', '10', 'reel', '2026-09', 500),
    m('4', '20', 'carrusel', '2026-10', 200, { responsables_objetivo: ['Mariano'] }),
    m('5', '30', 'reel', '2026-10', 300, { medido_at: null, alcance: null }),
  ];
  const panel = buildPanel({ period: '2026-10', clients, accounts, media,
    objectives: [{ clave: 'cliente-1', reels: 4, carruseles: 4 }],
    followers: [{ ig_user_id: '10', tipo: 'actual', seguidores: 1100 }, { ig_user_id: '10', tipo: 'inicio', seguidores: 1000 }],
    pieces: [{ clave: 'cliente-1', tipo: 'video', estado: 'publicada', responsables: ['Augusto'] },
      { clave: 'cliente-1', tipo: 'carrusel', estado: 'en_diseño', responsables: ['Augusto'] }] });
  assert.deepEqual(panel.clientes.map(c => c.nombre), ['Bohle', 'Lavalle']);
  const bohle = panel.clientes[0];
  assert.equal(bohle.actual.piezas, 2);
  assert.equal(bohle.actual.alcance, 1500);
  assert.equal(bohle.anterior.alcance, 500);
  assert.equal(bohle.cumplimiento, 25);
  assert.equal(bohle.crecimiento_seguidores, 100);
  assert.equal(bohle.sin_vincular, 1);
  assert.equal(bohle.actual.tasa_interaccion, 10);
  const lavalle = panel.clientes[1];
  assert.equal(lavalle.actual.piezas, 2);
  assert.equal(lavalle.actual.medidas, 1, 'una pieza sin medición no suma a promedios');
  const augusto = panel.equipo.find(p => p.nombre === 'Augusto');
  assert.deepEqual([augusto.asignadas, augusto.publicadas_sistema, augusto.totales.piezas], [2, 1, 1]);
  assert.equal(panel.equipo.find(p => p.nombre === 'Mariano').totales.alcance, 200);
  assert.equal(panel.cuentas_sin_cliente, 1);
  assert.equal(panel.totales.piezas, 4);
  assert.deepEqual(panel.ultima_sincronizacion, new Date('2026-10-31T10:00:00Z'));
});
