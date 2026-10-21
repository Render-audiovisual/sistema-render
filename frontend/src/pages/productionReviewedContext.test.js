import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { hasReviewedProductionContext, productionVisitEditInput } from './productionVisitEdit.js';

const draft={fecha:'2026-11-07',titulo:'Título actualizado',participante_ids:[7],drive_url:'https://example.invalid/material',observaciones:'Notas',cliente_id:999,estado:'publicada',contexto_historico_revisado:false};
test('reviewed forms omit source dimensions even when draft has a changed date or injected client',()=>{
  const input=productionVisitEditInput({contexto_historico_revisado:true},draft);
  assert.deepEqual(input,{titulo:draft.titulo,participante_ids:[7],drive_url:draft.drive_url,observaciones:'Notas'});
  assert.equal(hasReviewedProductionContext({contexto_historico_revisado:true}),true);
  assert.equal(draft.fecha,'2026-11-07','Building a write does not erase the draft');
});
test('ordinary visits retain manual date edits; non-boolean flags never become authority',()=>{
  for(const flag of [undefined,false,null,'true',1,{}]) {
    const visit={contexto_historico_revisado:flag};
    assert.equal(hasReviewedProductionContext(visit),false);
    const input=productionVisitEditInput(visit,draft);
    assert.equal(input.fecha,draft.fecha);
    assert.equal(Object.hasOwn(input,'cliente_id'),false);
    assert.equal(Object.hasOwn(input,'estado'),false);
  }
});
test('actual visit form binds reviewed explanation/date and projects PATCH input while other controls remain usable',()=>{
  const source=readFileSync(new URL('./Productions.jsx',import.meta.url),'utf8');
  const editor=source.slice(source.indexOf('function VisitEditor('),source.indexOf('function VisitAgendaItem('));
  assert.match(editor,/const reviewed = hasReviewedProductionContext\(visit\)/);
  assert.match(editor,/type="date" disabled=\{busy \|\| reviewed\}/);
  assert.match(editor,/aria-describedby=\{reviewed \? `reviewed-context-\$\{visit.id\}` : undefined\}/);
  assert.match(editor,/Fecha y cliente protegidos/);
  assert.match(editor,/onWrite\(intent.visit,'','PATCH',productionVisitEditInput\(intent.visit,intent.draft\)\)/);
  assert.match(editor,/<button disabled=\{busy \|\| form.pending \|\| form.blocked\} type="submit">Guardar visita/);
  assert.match(editor,/<Participants[^>]+disabled=\{busy\}/);
});
