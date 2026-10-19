import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { getRecordedTaskContext, safeMaterialUrl } from './taskRecordedContext.js';

const context = propiedades_extra => getRecordedTaskContext({ propiedades_extra });

test('nonempty authorized DTO fields produce only the closed recorded context', () => {
  assert.deepEqual(context({
    material: ' Carpeta A ', Material: ['Carpeta B'], feedback: 'Revisar audio',
    motivo_bloqueo: ['Falta aprobación'], horario: 'Después de almorzar, confirmar con cliente', coordinada: true,
  }), [
    { key: 'material', label: 'Material registrado', values: ['Carpeta A', 'Carpeta B'] },
    { key: 'feedback', label: 'Feedback registrado', values: ['Revisar audio'] },
    { key: 'motivo_bloqueo', label: 'Motivo de bloqueo registrado', values: ['Falta aprobación'] },
    { key: 'horario', label: 'Horario registrado', values: ['Después de almorzar, confirmar con cliente'] },
    { key: 'coordinada', label: 'Coordinación registrada', values: ['Sí'] },
  ]);
});

test('empty, malformed, inherited and unknown fields do not invent content', () => {
  for (const task of [null, undefined, '', [], {}, { propiedades_extra: null },
    { propiedades_extra: [] }, { propiedades_extra: 'material' },
    { metadata: { material: 'not the DTO field' } }]) assert.equal(getRecordedTaskContext(task), null);
  assert.equal(context({ material: ' ', Material: [], feedback: [' ', null], horario: '', coordinada: null }), null);
  assert.equal(context({ salario: '100', finanzas: 'secret', usuario: 'admin', rol: 'admin',
    asignado_a: 'German', material_referencia: 'not a legacy key', other: 'hidden' }), null);
  assert.equal(context(Object.create({ material: 'inherited', coordinada: true })), null);
  assert.equal(getRecordedTaskContext(Object.create({ propiedades_extra: { material: 'inherited' } })), null);
});

test('only strings and flat array strings are accepted; objects are never coerced', () => {
  const evil = { toString() { throw new Error('must not coerce'); } };
  for (const key of ['material', 'Material', 'feedback', 'motivo_bloqueo', 'horario']) {
    for (const value of [evil, 123, false, true, [evil, null, 7, ['nested']]]) {
      assert.equal(context({ [key]: value }), null);
    }
    assert.deepEqual(context({ [key]: [evil, ' visible ', false, ['nested']] })[0].values, ['visible']);
  }
  const metadata = {};
  Object.defineProperty(metadata, 'material', { get() { throw new Error('must not invoke getters'); } });
  assert.equal(context(metadata), null);
});

test('identical material variants deduplicate in stable order without merging distinct text', () => {
  assert.deepEqual(context({ material: ['A', ' A ', 'B'], Material: ['B', 'C', 'a'] })[0].values, ['A', 'B', 'C', 'a']);
  assert.deepEqual(context({ material: 'A', Material: 'A' })[0].values, ['A']);
});

test('coordinada accepts strict booleans including meaningful recorded false', () => {
  assert.deepEqual(context({ coordinada: true })[0].values, ['Sí']);
  assert.deepEqual(context({ coordinada: false })[0].values, ['No']);
  for (const coordinada of ['true', 'false', 'sí', 1, 0, [], {}, null, undefined]) {
    assert.equal(context({ coordinada }), null);
  }
});

test('malicious markup and unsafe URLs remain literal text; horario remains unparsed', () => {
  const literal = '<img src=x onerror=alert(1)> javascript:alert(1)';
  const horario = 'not-a-date / 32 de nunca / <script>alert(1)</script>';
  const rows = context({ material: literal, feedback: [literal], motivo_bloqueo: literal, horario });
  assert.deepEqual(rows.map(row => row.values), [[literal], [literal], [literal], [horario]]);
});

test('frozen input is not mutated and output arrays do not alias DTO arrays', () => {
  const material = Object.freeze([' A ', 'B']);
  const metadata = Object.freeze({ material, Material: 'A', horario: 'cuando confirmen', coordinada: false });
  const task = Object.freeze({ id: 7, propiedades_extra: metadata });
  const before = JSON.stringify(task);
  const rows = getRecordedTaskContext(task);
  rows[0].values.push('local presentation only');
  assert.equal(JSON.stringify(task), before);
  assert.deepEqual(getRecordedTaskContext(task)[0].values, ['A', 'B']);
});

test('safe material URLs allow only complete absolute HTTP(S) without credentials or controls', () => {
  for (const value of ['https://example.test/material?x=1&y=2#file', 'http://example.test/', 'HTTPS://example.test/file']) {
    assert.equal(safeMaterialUrl(value), new URL(value).href);
  }
  for (const value of [null, undefined, 1, {}, ['https://example.test'], '', 'plain text',
    'javascript:alert(1)', 'data:text/html,<script>alert(1)</script>', '/material', '//example.test/material',
    'https:example.test', 'https:///example.test', 'ftp://example.test',
    'https://user:password@example.test/', 'https://user@example.test/', 'https://@example.test/',
    'https://example.test/a\nb', 'https://example.test/a\tb', 'https://example.test/\u0000',
    'https://example.test/%0d%0a', 'https://example.test/%7f', ' https://example.test',
    'https://example.test trailing prose', 'Read https://example.test',
    '<a href="https://example.test">material</a>', 'https://example.test/<script>alert(1)</script>',
    'https://example.test/"onclick="alert(1)', 'https://example.test\\@evil.test']) {
    assert.equal(safeMaterialUrl(value), null, String(value));
  }
});

test('markup is kept literal by the extractor and is never accepted as a material URL', () => {
  const value = '<img src=x onerror=alert(1)> https://example.test';
  assert.equal(context({ material: value })[0].values[0], value);
  assert.equal(safeMaterialUrl(value), null);
});

test('component source limits safe anchors to material and keeps other content as React text', () => {
  // Source contract, not a claim of rendered/browser verification.
  const source = readFileSync(new URL('./TaskRecordedContext.jsx', import.meta.url), 'utf8');
  assert.match(source, /import \{ getRecordedTaskContext, safeMaterialUrl \} from '\.\/taskRecordedContext\.js'/);
  assert.match(source, /getRecordedTaskContext\(task\)/);
  assert.match(source, /if \(!rows\) return null/);
  assert.match(source, /className="ros-work-block ros-recorded-context"/);
  assert.match(source, /<h3>Material y coordinación<\/h3>/);
  assert.match(source, /<dl>/);
  assert.match(source, /<dt>\{row.label\}<\/dt>/);
  assert.match(source, /row.key === 'material' \? safeMaterialUrl\(value\) : null/);
  assert.match(source, /<a href=\{href\} target="_blank" rel="noopener noreferrer">\{value\}<\/a>/);
  assert.match(source, /: value\}<\/p>/);
  assert.doesNotMatch(source, /dangerouslySetInnerHTML|innerHTML|fetch\(|useEffect|onClick|\.css['"]|localStorage|sessionStorage/);
});
