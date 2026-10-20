const fail=(message,status=400,code='CONTRACT_INVALID')=>Object.assign(new Error(message),{status,code});
export const CONTRACT_REVISION_SQL="concat('fc1:',id,':',contract_version)";
export function contractId(value) {
  if(typeof value!=='string'||!/^[1-9]\d*$/.test(value)||String(Number(value))!==value||Number(value)>2147483647)throw fail('Contrato inválido.');
  return Number(value);
}
export function expectedContractVersion(value,id) {
  if(value===undefined)throw fail('Abrí el contrato guardado antes de modificarlo.',428,'CONTRACT_REVISION_REQUIRED');
  const match=typeof value==='string'&&/^fc1:([1-9]\d*):([1-9]\d*)$/.exec(value);
  if(!match||match[0]!==value||match.slice(1).some(part=>Number(part)>2147483647))throw fail('La versión del contrato no es válida.',400,'CONTRACT_REVISION_INVALID');
  if(Number(match[1])!==id)throw fail('La versión corresponde a otro contrato. Revisá el registro antes de guardar.',409,'CONTRACT_REVISION_CONFLICT');
  return Number(match[2]);
}
export function isContractDate(value) {
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||value.length!==10)return false;
  const [y,m,d]=value.split('-').map(Number),leap=y%400===0||(y%4===0&&y%100!==0);
  return y>=1&&y<=9999&&m>=1&&m<=12&&d>=1&&d<=[31,leap?29:28,31,30,31,30,31,31,30,31,30,31][m-1];
}
export function normalizeContractInput(body,{operation='patch'}={}) {
  const fields=operation==='archive'?['expected_revision']:['nombre','importe_mensual','inicia_el','finaliza_el',...(operation==='patch'?['activo','expected_revision']:[])];
  if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(key=>!fields.includes(key)))throw fail('Los campos del contrato no son válidos.');
  const value={};
  if(operation==='create'||Object.hasOwn(body,'nombre')){
    if(typeof body.nombre!=='string'||!body.nombre.trim()||body.nombre.trim().length>250)throw fail('Ingresá un nombre de contrato de hasta 250 caracteres.');
    value.nombre=body.nombre.trim();
  }
  if(operation==='create'||Object.hasOwn(body,'importe_mensual')){
    const amount=(typeof body.importe_mensual==='number'||typeof body.importe_mensual==='string')?String(body.importe_mensual):'';
    if(!/^(0|[1-9]\d{0,11})(\.\d{1,2})?$/.test(amount)||amount.trim()!==amount)throw fail('Ingresá un monto no negativo con hasta dos decimales.');
    value.importe_mensual=amount;
  }
  for(const key of ['inicia_el','finaliza_el']){
    if(!(operation==='create'&&key==='inicia_el')&&!Object.hasOwn(body,key))continue;
    if(key==='finaliza_el'&&(body[key]===null||body[key]===''))value[key]=null;
    else if(!isContractDate(body[key]))throw fail('Las fechas del contrato no son válidas.');
    else value[key]=body[key];
  }
  if(Object.hasOwn(body,'activo')){
    if(typeof body.activo!=='boolean')throw fail('El estado del contrato no es válido.');
    value.activo=body.activo;
  }
  if(operation==='patch'&&!Object.keys(value).length)throw fail('No hay campos para actualizar.');
  return value;
}
export async function contractNotUpdated(pool,id) {
  const exists=await pool.query('SELECT id FROM contratos_financieros WHERE id=$1',[id]);
  throw exists.rowCount?fail('Otro integrante modificó el contrato. Conservá tus cambios y revisá la versión guardada.',409,'CONTRACT_REVISION_CONFLICT')
    :fail('Contrato no encontrado.',404,'CONTRACT_NOT_FOUND');
}
