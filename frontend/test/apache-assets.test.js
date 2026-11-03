import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../public/.htaccess', import.meta.url), 'utf8');
const directives = source.split(/\r?\n/).map(line => line.trim())
  .filter(line => line && !line.startsWith('#'));

test('assets stop before SPA fallback, including missing nested JS/CSS and extensionless assets', () => {
  const exclusion = 'RewriteRule ^assets(?:/|$) - [END]';
  const index = directives.indexOf(exclusion);
  assert.ok(index > directives.indexOf('RewriteBase /'));
  // No file-existence condition may attach to this exclusion: missing files
  // must reach Apache unchanged too. END terminates per-directory rewriting.
  assert.equal(directives[index - 1], 'RewriteBase /');
  assert.ok(index < directives.indexOf('RewriteCond %{REQUEST_FILENAME} !-f'));
  assert.ok(index < directives.indexOf('RewriteRule ^ index.html [QSA,L]'));
  const [, pattern, substitution, flags] = exclusion.split(/\s+/);
  assert.equal(substitution, '-');
  assert.equal(flags, '[END]');
  const assetPath = new RegExp(pattern);
  // Apache RewriteRule paths in root .htaccess have no leading slash;
  // query strings are not part of the matched path.
  for (const path of ['assets', 'assets/', 'assets/old-hash.js',
    'assets/old-hash.css', 'assets/nested/chunk.js', 'assets/missing']) {
    assert.equal(assetPath.test(path), true, path);
  }
  for (const path of ['', 'inicio', 'clientes/123', 'assets-report', 'my/assets/chunk.js']) {
    assert.equal(assetPath.test(path), false, path);
  }
});

test('existing-file protection, SPA fallback and all header directives remain unchanged', () => {
  assert.match(source, /RewriteCond %\{REQUEST_FILENAME\} !-f\s+RewriteCond %\{REQUEST_FILENAME\} !-d\s+(?:#[^\n]*\n\s*)*RewriteRule \^ index\.html \[QSA,L\]/);
  assert.deepEqual(directives.filter(line => /^(?:Header|<\/?Files)/.test(line)), [
    '<FilesMatch "\\.js$|\\.css$">',
    'Header set Cache-Control "public, max-age=31536000, immutable"',
    '</FilesMatch>',
    '<Files "index.html">',
    'Header set Cache-Control "public, max-age=0, must-revalidate"',
    '</Files>',
  ]);
});
