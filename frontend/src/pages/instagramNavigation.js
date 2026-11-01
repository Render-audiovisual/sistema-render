const tabs=new Set(['clientes','equipo','reportes','cuentas']);
const validClient=value=>typeof value==='string'&&/^(cliente|grupo)-[1-9]\d{0,9}$/.test(value)&&Number(value.split('-')[1])<=2147483647;
export function readInstagramLocation(search,fallbackPeriod) {
  const p=new URLSearchParams(search||'');
  const error=()=>({period:fallbackPeriod,tab:'clientes',selected:null,error:'El enlace del reporte no es válido. Elegí el mes y el cliente nuevamente.'});
  if(['periodo','cliente','tab'].some(k=>p.getAll(k).length>1))return error();
  const period=p.get('periodo')||fallbackPeriod,tab=p.get('tab')||'clientes',selected=p.get('cliente')||null;
  if(!/^20\d\d-(0[1-9]|1[0-2])$/.test(period)||!tabs.has(tab)||(selected&&!validClient(selected)))return error();
  return {period,tab:selected?'clientes':tab,selected,error:''};
}
export function instagramPanelHref({period,tab='clientes',selected=null}) {
  const p=new URLSearchParams({periodo:period});if(tab!=='clientes')p.set('tab',tab);if(selected)p.set('cliente',selected);
  return `/instagram?${p}`;
}
export function instagramReportHref(cliente,periodo) {
  if(!validClient(cliente)||!/^20\d\d-(0[1-9]|1[0-2])$/.test(periodo))throw new Error('Reporte inválido');
  return `/instagram/reporte?${new URLSearchParams({cliente,periodo})}`;
}
