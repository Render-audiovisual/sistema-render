import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const sql=readFileSync(new URL('../migrations/081_team_payment_ledger.sql',import.meta.url),'utf8');
test('payment ledger is additive and never backfills legacy salaries, names or commercial rows',()=>{
  assert.match(sql,/CREATE TABLE team_payments/);
  assert.match(sql,/CREATE TABLE team_payment_events/);
  assert.match(sql,/CREATE TABLE team_payment_receipts/);
  assert.doesNotMatch(sql,/\b(?:INSERT\s+INTO|ALTER\s+TABLE|DROP\s+TABLE|TRUNCATE)\b/i);
  assert.doesNotMatch(sql,/\b(?:empleado_pagos_mensuales|empleado_compensaciones|contratos_financieros|cliente_abonos)\b/);
});
test('ledger separates stable user identity, actual date, work month, manual provenance and exact money',()=>{
  assert.match(sql,/recipient_id INTEGER NOT NULL REFERENCES usuarios\(id\) ON DELETE RESTRICT/);
  assert.match(sql,/recorded_by_id INTEGER NOT NULL REFERENCES usuarios\(id\) ON DELETE RESTRICT/);
  assert.match(sql,/fecha_pago DATE NOT NULL/);assert.match(sql,/periodo_trabajo DATE NOT NULL CHECK/);
  assert.match(sql,/NUMERIC\(14,2\) NOT NULL CHECK \(importe > 0\)/);
  assert.match(sql,/CHECK \(provenance = 'manual'\)/);
  assert.match(sql,/PRIMARY KEY\(actor_id,operation_key\)/);
});
test('original history cannot be deleted or rewritten into a different payment; only versioned void permitted',()=>{
  assert.match(sql,/TG_OP = 'DELETE'/);
  assert.match(sql,/BEFORE UPDATE OR DELETE ON team_payments/);
  assert.match(sql,/OLD.status <> 'recorded' OR NEW.status <> 'voided' OR NEW.version <> OLD.version\+1/);
  assert.match(sql,/to_jsonb\(NEW\)[\s\S]*IS DISTINCT FROM \(to_jsonb\(OLD\)/);
  assert.match(sql,/status='voided' AND voided_at IS NOT NULL AND voided_by_id IS NOT NULL/);
});
