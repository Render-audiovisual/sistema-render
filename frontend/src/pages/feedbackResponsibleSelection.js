import {normalizeFeedbackResponsibleIds} from '../../../shared/feedback-responsibles.mjs';

const positive=value=>Number.isSafeInteger(value)&&value>0&&value<=2147483647;
export const hasFeedbackResponsibleIds=value=>Boolean(value&&Object.hasOwn(value,'responsable_ids'));
export function feedbackResponsibleIds(value){
  return hasFeedbackResponsibleIds(value)?normalizeFeedbackResponsibleIds(value.responsable_ids):null;
}
export function feedbackLegacyResponsibleLabels(value){
  const values=Array.isArray(value?.responsables)?value.responsables:[value?.responsable];
  return [...new Set(values.filter(item=>typeof item==='string').map(item=>item.trim()).filter(Boolean))];
}
export function feedbackResponsibleCatalog(value){
  if(!Array.isArray(value)||value.some(user=>!positive(user?.id)||typeof user.nombre!=='string'
    ||typeof user.usuario!=='string'||!user.usuario.trim()||typeof user.activo!=='boolean')
    ||new Set(value.map(user=>user.id)).size!==value.length)throw new Error('No se pudo verificar el catálogo de responsables.');
  return value.map(({id,nombre,usuario,activo})=>({id,nombre,usuario,activo}));
}
export function feedbackResponsibleLabel(id,users){
  const user=users.find(item=>item.id===id);
  if(!user)return `Usuario #${id} (no disponible)`;
  return `${user.nombre||user.usuario} · ${user.usuario} · #${id}${user.activo===true?'':' (inactivo)'}`;
}
export function feedbackResponsibleDisplay(value,users){
  const ids=feedbackResponsibleIds(value);
  return ids===null?feedbackLegacyResponsibleLabels(value)
    :ids.map(id=>feedbackResponsibleLabel(id,users));
}
export function toggleFeedbackResponsibleId(value,id,users){
  if(!positive(id))throw new Error('Elegí una identidad válida.');
  const selected=feedbackResponsibleIds(value)??[];
  let ids;
  if(selected.includes(id))ids=selected.filter(item=>item!==id);
  else{
    if(!users.some(user=>user.id===id&&user.activo===true))throw new Error('Elegí una persona activa del catálogo.');
    ids=normalizeFeedbackResponsibleIds([...selected,id]);
  }
  const responsables=ids.map(selectedId=>{
    const user=users.find(item=>item.id===selectedId);
    return user?.nombre||user?.usuario||`Usuario #${selectedId}`;
  });
  return {...value,responsable_ids:ids,responsables,responsable:responsables[0]||''};
}
