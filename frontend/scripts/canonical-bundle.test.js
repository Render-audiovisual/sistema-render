import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { build } from 'vite';
import { parallelEntrypoints, parallelModulesInBundle } from './canonical-bundle.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const base = { root, configFile: path.join(root, 'vite.config.js'), envFile: false,
  logLevel: 'silent', build: { write: false, minify: false, reportCompressedSize: false } };

test('actual production build emits canonical App and no parallel entrypoints, including lazy chunks', async () => {
  const result = await build(base);
  assert.ok(!Array.isArray(result) && result.output);
  const chunks = result.output.filter(item => item.type === 'chunk');
  const modules = chunks.flatMap(chunk => Object.keys(chunk.modules));
  assert.ok(modules.includes(path.join(root, 'src/main.jsx')));
  assert.ok(modules.includes(path.join(root, 'src/App.jsx')));
  assert.ok(modules.includes(path.join(root, 'src/pages/Publicaciones.jsx')));
  assert.ok(!modules.some(id => /\/(?:MoodboardPreview|Drive)\.jsx$/.test(id)), 'Retired resource pages are not shipped');
  assert.ok(chunks.some(chunk => chunk.isDynamicEntry), 'Inspect lazy output, not just entry chunk');
  assert.deepEqual(parallelModulesInBundle(Object.fromEntries(chunks.map(chunk => [chunk.fileName, chunk])), root), []);
});

for (const lazy of [false, true]) for (const entry of parallelEntrypoints) test(`real build guard rejects ${lazy ? 'lazy' : 'static'} parallel module ${entry}`, async () => {
  const forbidden = path.join(root, entry), probe = '\0render-canonical-negative-probe';
  await assert.rejects(build({ ...base,
    plugins: [{ name: 'qa-synthetic-parallel-import',
      resolveId(id) { if (id === probe) return probe; },
      load(id) {
        if (id === probe) return lazy ? `import(${JSON.stringify(forbidden)});` : `import ${JSON.stringify(forbidden)};`;
        // Synthetic side-effect module ensures this exact path is emitted, not
        // merely imported then tree-shaken. No reference app code is executed.
        if (id === forbidden) return 'console.info("synthetic QA parallel entry");';
      },
    }], build: { ...base.build, rollupOptions: { input: probe } },
  }), error => error.plugin === 'render-canonical-bundle-guard'
    && error.message.includes('Render release includes parallel entrypoints:') && error.message.includes(entry));
});
