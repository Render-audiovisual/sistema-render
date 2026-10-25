// Empty UI selection is explicit in new URLs. Only old links without filtro
// inherit cliente; cliente remains independent as the default creation target.
export function readStoryPlanillaFilter(search, fallbackVista='estructura') {
  const params=new URLSearchParams(search);
  if(params.has('filtro'))return params.get('filtro')==='all'?'':params.get('filtro');
  return (params.get('vista')||fallbackVista)==='planilla'?(params.get('cliente')||''):'';
}
export function storyPlanillaFilterQuery(value) {
  return value===''?'all':value;
}
