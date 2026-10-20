const fail=(message,status,code)=>Object.assign(new Error(message),{status,code});
export function clientAgreementRevisionSql(client='c',group='gf') {
  if (![client,group].every(alias=>typeof alias==='string'&&/^[a-z_]+$/.test(alias)&&alias.trim()===alias)) throw new Error('Invalid internal SQL alias');
  return `concat('a1:',${client}.id,':',${client}.agreement_version,':',COALESCE(${client}.grupo_feed_id,0),':',COALESCE(${group}.agreement_version,0))`;
}
export function assertAgreementRevision(value) {
  if(value===undefined)throw fail('Abrí el acuerdo guardado antes de modificarlo.',428,'CLIENT_AGREEMENT_REQUIRED');
  const match=typeof value==='string'&&/^a1:([1-9]\d*):([1-9]\d*):(0|[1-9]\d*):(0|[1-9]\d*)$/.exec(value);
  if(!match||match[0]!==value||match.slice(1).some(part=>Number(part)>2147483647)||((match[3]==='0')!==(match[4]==='0'))) {
    throw fail('La versión del acuerdo no es válida.',400,'CLIENT_AGREEMENT_INVALID');
  }
}
// All app client-administration writers acquire this BEFORE row locks. It is
// intentionally global while shared-feed membership remains a legacy domain.
export async function lockClientAdministration(db) {
  await db.query('SELECT pg_advisory_xact_lock(8142, 1)');
}
export async function readClientAgreementRevision(db,id) {
  const result=await db.query(`SELECT ${clientAgreementRevisionSql()} AS agreement_revision
    FROM public.clientes c LEFT JOIN public.grupos_feed gf ON gf.id=c.grupo_feed_id WHERE c.id=$1`,[id]);
  if(!result.rowCount)throw fail('Cliente no encontrado.',404,'CLIENT_NOT_FOUND');
  return result.rows[0].agreement_revision;
}
export async function lockClientAgreement(db,id,expected) {
  assertAgreementRevision(expected);
  await lockClientAdministration(db);
  const result=await db.query('SELECT id,grupo_feed_id FROM public.clientes WHERE id=$1 FOR UPDATE',[id]);
  if(!result.rowCount)throw fail('Cliente no encontrado.',404,'CLIENT_NOT_FOUND');
  const row=result.rows[0];
  if(row.grupo_feed_id)await db.query('SELECT id FROM public.grupos_feed WHERE id=$1 FOR UPDATE',[row.grupo_feed_id]);
  if(await readClientAgreementRevision(db,id)!==expected) {
    throw fail('Otro integrante modificó el acuerdo. Conservá tus cambios y revisá la versión guardada.',409,'CLIENT_AGREEMENT_CONFLICT');
  }
  return row;
}
