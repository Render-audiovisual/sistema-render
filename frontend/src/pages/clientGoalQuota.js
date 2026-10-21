const positive=value=>Number.isSafeInteger(value)&&value>0&&value<=2147483647;
const quantity=value=>Number.isSafeInteger(value)&&value>=0;
export const validGoalQuotaRevision=value=>typeof value==='string'&&value.length===64&&/^[a-f0-9]{64}$/.test(value);
export function validateGoalQuota(client){
  const current=client?.cuota_actual;
  if(typeof client?.preparado!=='boolean'||typeof client.cuota_desactualizada!=='boolean'
    ||![client.reels,client.carruseles].every(quantity)||!Array.isArray(client.piezas)
    ||!(current===null||current&&typeof current==='object'&&!Array.isArray(current)&&[current.reels,current.carruseles].every(quantity))
    ||!(client.cuota_revision===null||validGoalQuotaRevision(client.cuota_revision))
    ||(client.preparado&&current!==null&&!validGoalQuotaRevision(client.cuota_revision))
    ||(!client.preparado&&(client.cuota_desactualizada||client.cuota_revision!==null)))throw new Error('No se pudo verificar la cuota del objetivo.');
  const slots=new Set();
  for(const piece of client.piezas){
    const key=`${piece.tipo}:${piece.numero}`;
    if(!['video','carrusel'].includes(piece.tipo)||!positive(piece.numero)||typeof piece.en_cuota!=='boolean'
      ||piece.en_cuota!==(piece.numero<=(piece.tipo==='video'?client.reels:client.carruseles))||slots.has(key))throw new Error('No se pudo verificar qué contenido corresponde a la cuota.');
    slots.add(key);
  }
  return {prepared:client.preparado,current:current===null?null:{reels:current.reels,carruseles:current.carruseles},stored:{reels:client.reels,carruseles:client.carruseles},drift:client.cuota_desactualizada,revision:client.cuota_revision};
}
export function goalQuotaProgress(client,type){
  const pieces=(client?.piezas||[]).filter(piece=>!type||piece.tipo===type);
  const quota=pieces.filter(piece=>piece.en_cuota===true),additional=pieces.filter(piece=>piece.en_cuota===false);
  return {quota,additional,completed:quota.filter(piece=>['finalizada','publicada'].includes(piece.estado)).length};
}
export function goalPreparationRevision(client){
  if(client?.preparado===true&&client.cuota_actual===null&&client.preparacion_revision===null)return null;
  if(!validGoalQuotaRevision(client?.preparacion_revision))throw new Error('No se pudo verificar la preparación del objetivo. Recargá antes de continuar.');
  return client.preparacion_revision;
}
export function goalPreparationBody({client,period,formats,accounts,role,acknowledged}){
  const observation=validateGoalQuota(client),revision=goalPreparationRevision(client);
  const match=typeof client.clave==='string'&&/^(cliente|grupo)-([1-9]\d*)$/.exec(client.clave);
  if(!['admin','community'].includes(role)||acknowledged!==true||!revision||observation.drift||!match||match[0]!==client.clave||!positive(Number(match[2]))
    ||typeof period!=='string'||period.length!==7||!/^(?!0000)\d{4}-(0[1-9]|1[0-2])$/.test(period)||period<'2026-10'
    ||!Array.isArray(client.cuentas)||!client.cuentas.length||client.cuentas.some(account=>!positive(account.id))||new Set(client.cuentas.map(account=>account.id)).size!==client.cuentas.length
    ||client.reels+client.carruseles===0||client.reels>100||client.carruseles>100)throw new Error('Revisá el mes, la cuota y las cuentas antes de confirmar la preparación.');
  if(!formats||Object.keys(formats).some(type=>!['video','carrusel'].includes(type))||!['video','carrusel'].every(type=>Array.isArray(formats[type])&&formats[type].every(positive)))throw new Error('Revisá los responsables de cada formato.');
  const responsables=[...new Set(Object.values(formats).flat())];
  if(!responsables.length||responsables.length>20||client.reels>0&&!formats.video.length||client.carruseles>0&&!formats.carrusel.length)throw new Error('Elegí responsables para las tareas nuevas de cada formato.');
  const shared=client.cuentas.length>1;
  if(shared&&(!accounts||Object.keys(accounts).length!==client.cuentas.length||client.cuentas.some(account=>!Array.isArray(accounts[account.id])||!accounts[account.id].length||accounts[account.id].some(id=>!positive(id)||!responsables.includes(id)))))throw new Error('Revisá los responsables de cada cuenta del objetivo.');
  return {periodo:period,clave:client.clave,responsables,responsables_por_formato:{video:[...formats.video],carrusel:[...formats.carrusel]},...(shared?{responsables_por_cuenta:Object.fromEntries(client.cuentas.map(account=>[account.id,[...accounts[account.id]]]))}:{}),expected_preparation_revision:revision};
}
export function goalQuotaReviewBody({client,period,formats,accounts,role,acknowledged}){
  const observation=validateGoalQuota(client);
  if(role!=='admin'||!observation.prepared||!observation.drift||!observation.current||!validGoalQuotaRevision(observation.revision)
    ||!positive(client.id)||typeof client.clave!=='string'||!client.clave||acknowledged!==true
    ||typeof period!=='string'||period.length!==7||!/^(?!0000)\d{4}-(0[1-9]|1[0-2])$/.test(period)||period<'2026-10')throw new Error('Revisá la cuota vigente y confirmá que se conservará el contenido existente.');
  if(!formats||!['video','carrusel'].every(type=>Array.isArray(formats[type])&&formats[type].every(positive))
    ||Object.keys(formats).some(type=>!['video','carrusel'].includes(type)))throw new Error('Revisá los responsables de cada formato.');
  const responsables=[...new Set(Object.values(formats).flat())];
  if(!responsables.length||responsables.length>20||observation.current.reels>0&&!formats.video.length||observation.current.carruseles>0&&!formats.carrusel.length)throw new Error('Elegí responsables para las tareas nuevas de cada formato.');
  const shared=client.cuentas.length>1;
  if(shared&&(!accounts||Object.keys(accounts).length!==client.cuentas.length||client.cuentas.some(account=>!Array.isArray(accounts[account.id])||!accounts[account.id].length||accounts[account.id].some(id=>!positive(id)||!responsables.includes(id)))))throw new Error('Revisá los responsables de cada cuenta del objetivo.');
  return {periodo:period,clave:client.clave,responsables,responsables_por_formato:{video:[...formats.video],carrusel:[...formats.carrusel]},...(shared?{responsables_por_cuenta:Object.fromEntries(client.cuentas.map(account=>[account.id,[...accounts[account.id]]]))}:{}),expected_quota_revision:observation.revision};
}
export function verifiedGoalPreparationAck(value,expectedId){
  if(!positive(value?.objetivo_id)||expectedId!==undefined&&value.objetivo_id!==expectedId||![value.creadas,value.vinculadas].every(quantity))throw new Error('No se pudo verificar el resultado. Cerrá y revisá los datos guardados antes de repetirlo.');
  return {objetivo_id:value.objetivo_id,creadas:value.creadas,vinculadas:value.vinculadas};
}
