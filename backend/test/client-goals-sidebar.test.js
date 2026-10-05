import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('../../frontend/src/pages/ClientesObjetivos.jsx', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../../frontend/src/pages/ClientesObjetivos.css', import.meta.url), 'utf8');

test('la lista de clientes oculta el scroll visual pero conserva el desplazamiento', () => {
  const listStyles = styles.match(/\.cg-client-items\s*\{([^}]+)\}/)?.[1];
  assert.match(listStyles, /overflow-y:auto/);
  assert.match(listStyles, /max-height:calc\(100dvh - 190px\)/);
  assert.match(listStyles, /scrollbar-width:none/);
  assert.match(styles, /\.cg-client-items::-webkit-scrollbar\s*\{[^}]*display:none/);
});

test('las tarjetas muestran solo nombre y barra, con avance accesible y selección intacta', () => {
  const card = source.slice(source.indexOf('return <button className={`cg-client'), source.indexOf('<label className="cg-mobile-client"'));
  assert.ok(card.length > 0);
  assert.doesNotMatch(card, /<small>/);
  assert.match(card, /aria-label=\{`\$\{item.nombre\}:/);
  assert.match(card, /cg-client-progress/);
  assert.match(card, /count \/ quantity \* 100/);
  assert.match(card, /setSelectedKey\(item.clave\)/);
  assert.match(source, /select aria-label="Elegir cliente"/);
});

test('elimina la franja de búsqueda sin desactivar la actualización ni el reintento por error', () => {
  assert.doesNotMatch(source, /cg-toolbar|Buscar cliente|Usá Actualizar/);
  assert.doesNotMatch(styles, /cg-toolbar|cg-search/);
  assert.match(source, /setInterval\(update, 30000\)/);
  assert.match(source, /addEventListener\('visibilitychange', update\)/);
  assert.match(source, /onRetry=\{refresh\}/);
  assert.match(source, /current === AUTO_UPDATE_ERROR \? '' : current/);
});
