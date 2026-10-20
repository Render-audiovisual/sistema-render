import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { newPasswordError, PASSWORD_POLICY_MESSAGE } from '../../shared/password-policy.mjs';
import { normalizeUserCreateInput } from '../src/user-create-input.js';
import { normalizeSelfProfileInput } from '../src/self-profile-input.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
// Explicit expected cases, not a second implementation of the shared policy.
const cases = [
  ['missing', undefined, false], ['null', null, false], ['number', 123456789012, false],
  ['array', ['abcdefghijkl'], false], ['object', {}, false], ['empty', '', false],
  ['eleven ASCII', 'a'.repeat(11), false], ['twelve ASCII', 'a'.repeat(12), true],
  ['72 ASCII bytes', 'a'.repeat(72), true], ['73 ASCII bytes', 'a'.repeat(73), false],
  ['only spaces', ' '.repeat(12), false], ['only Unicode whitespace', '\u2003'.repeat(12), false],
  ['exact leading/trailing spaces', '  abcdefghijkl  ', true],
  ['spaces count without trimming', ' abcdefghij ', true],
  ['NUL', 'abcdef\0ghijkl', false],
  ['eleven astral code points', '😀'.repeat(11), false],
  ['twelve astral code points', '😀'.repeat(12), true],
  ['18 astral / 72 UTF8 bytes', '😀'.repeat(18), true],
  ['19 astral / 76 UTF8 bytes', '😀'.repeat(19), false],
  ['36 accented / 72 UTF8 bytes', 'é'.repeat(36), true],
  ['accented overflow at 73 bytes', 'é'.repeat(36) + 'a', false],
  ['24 CJK / 72 UTF8 bytes', '界'.repeat(24), true],
  ['CJK overflow at 73 bytes', '界'.repeat(24) + 'a', false],
  ['decomposed points retained', 'e\u0301'.repeat(6), true],
  ['composed six points not normalized', 'é'.repeat(6), false],
  ['unpaired high surrogate', 'abcdefghijkl\ud800', false],
  ['unpaired low surrogate', 'abcdefghijkl\udfff', false],
];

test('shared policy and both backend entry points agree on explicit Unicode/space boundaries', () => {
  for (const [label, password, valid] of cases) {
    assert.equal(newPasswordError(password), valid ? null : PASSWORD_POLICY_MESSAGE, label);
    const create = () => normalizeUserCreateInput({ usuario: 'qa_policy', nombre: 'QA Policy', rol: 'diseno', password });
    const self = () => normalizeSelfProfileInput({ usuario: 'qa_policy', password_actual: 'legacy', password_nueva: password }, 'password');
    if (valid) {
      assert.equal(create().password, password, `${label}: create must preserve exact input`);
      assert.equal(self().password_nueva, password, `${label}: self must preserve exact input`);
      assert.equal(self().password_actual, 'legacy', 'new policy must not reject legacy current credentials');
    } else {
      assert.throws(create, error => {
        assert.equal(error.status, 400, label);
        assert.equal(error.message, PASSWORD_POLICY_MESSAGE, label);
        return true;
      });
      assert.throws(self, error => {
        assert.equal(error.status, 400, label);
        if (typeof password === 'string') {
          assert.equal(error.code, 'NEW_PASSWORD_INVALID', label);
          assert.equal(error.message, PASSWORD_POLICY_MESSAGE, label);
        } else {
          assert.equal(error.code, 'PROFILE_INPUT_INVALID', label);
          assert.equal(error.message, 'Los datos del perfil no son válidos.', label);
        }
        // Neither validation layer may attach credentials or input echoes.
        for (const field of ['password', 'password_nueva', 'password_actual', 'value', 'input', 'body'])
          assert.equal(Object.hasOwn(error, field), false, `${label}: no ${field} echo`);
        return true;
      });
    }
  }
});

test('browser and backend consumers import the same explicit .mjs public policy', () => {
  for (const relative of ['backend/src/user-create-input.js', 'backend/src/self-profile-input.js', 'frontend/src/pages/Perfil.jsx']) {
    const source = readFileSync(path.join(root, relative), 'utf8');
    const imported = source.match(/import\s*\{[^}]*\bnewPasswordError\b[^}]*\}\s*from\s*['"]([^'"]+password-policy\.mjs)['"]/);
    assert.ok(imported, `${relative}: direct shared-policy import required`);
    assert.equal(path.resolve(path.dirname(path.join(root, relative)), imported[1]), path.join(root, 'shared/password-policy.mjs'));
  }
});

test('isolated shared-only deployment copy imports without package type or installers', async () => {
  const temporary = mkdtempSync(path.join(tmpdir(), 'render-password-policy-packaging-'));
  try {
    // Copy ONLY public shared source. Do not import/execute the real build script:
    // it removes hostinger-dist and invokes npm ci against the application.
    cpSync(path.join(root, 'shared'), path.join(temporary, 'shared'), { recursive: true });
    const copied = await import(pathToFileURL(path.join(temporary, 'shared/password-policy.mjs')).href);
    assert.notEqual(copied.newPasswordError, newPasswordError, 'exercise the copied module, not the original module cache');
    assert.equal(copied.PASSWORD_POLICY_MESSAGE, PASSWORD_POLICY_MESSAGE);
    for (const [label, password, valid] of cases)
      assert.equal(copied.newPasswordError(password), valid ? null : PASSWORD_POLICY_MESSAGE, label);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});

test('Hostinger static copy list preserves shared alongside backend/src', () => {
  const source = readFileSync(path.join(root, 'scripts/build-hostinger-output.mjs'), 'utf8');
  const list = source.match(/for\s*\(const\s+relativePath\s+of\s*\[([^\]]*)\]\)/);
  assert.ok(list, 'inspect the real deployment copy list without executing the script');
  const entries = [...list[1].matchAll(/['"]([^'"]+)['"]/g)].map(match => match[1]);
  assert.ok(entries.includes('shared'), 'root shared module must be deployed');
  assert.ok(entries.includes('backend/src'), 'backend sources must be deployed');
  assert.match(source, /cpSync\(path\.join\(projectRoot, relativePath\), path\.join\(outputRoot, relativePath\)/);
});
