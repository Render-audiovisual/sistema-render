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

test('las tarjetas preparadas muestran nombre y barra; las no preparadas informan su estado sin avance ficticio y conservan selección accesible', () => {
  const card = source.slice(source.indexOf('return <button className={`cg-client'), source.indexOf('<label className="cg-mobile-client"'));
  assert.ok(card.length > 0);
  assert.match(card, /\{item\.preparado \? <span className="cg-client-progress"[\s\S]*?<\/span> : <small>Objetivo por preparar<\/small>\}/);
  const unprepared = card.match(/: <small>([^<]+)<\/small>/)?.[1];
  assert.equal(unprepared, 'Objetivo por preparar');
  assert.doesNotMatch(unprepared, /\d|%|completad|\//);
  assert.match(card, /aria-label=\{`\$\{item.nombre\}:/);
  assert.match(card, /item\.preparado \? `\$\{count\} de \$\{quantity\} completados` : 'Objetivo por preparar'/);
  assert.match(card, /cg-client-progress/);
  assert.match(card, /count \/ quantity \* 100/);
  assert.match(card, /aria-pressed=\{item\.clave === activeKey\}/);
  assert.match(card, /disabled=\{Boolean\(preparing \|\| selectedPiece\)\}/);
  assert.match(card, /chooseClient\(item.clave\)/);
  assert.match(source, /const activeKey = client\?\.clave \|\| ''/);
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

test('el encabezado conserva el selector mensual sin el botón Administración', () => {
  const start = source.indexOf('<header className="cg-header">');
  const end = source.indexOf('</header>', start);
  assert.ok(start >= 0 && end > start, 'El encabezado real debe estar delimitado');
  const header = source.slice(start, end + '</header>'.length);
  assert.ok(header.length > 0);
  assert.doesNotMatch(header, /Administración|gestion=1/);
  assert.match(header, /aria-label="Mes de trabajo" type="month"/);
  assert.match(header, /changeGoalContext\(\{period:event.target.value\}\)/);
});
