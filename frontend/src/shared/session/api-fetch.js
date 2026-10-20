import { parseCurrentSession } from './current-session.js';
import { loginHrefForDestination } from '../navigation/login-destination.js';

// Capture the actual sent identity. A late response must not invalidate a newer
// account/session, and explicit captured credentials must not be overwritten.
export function createAuthenticatedApiFetch({fetchImpl,storage,location,apiBase=''}) {
  const read=()=>{try{return parseCurrentSession(storage.getItem('render_sesion'));}catch{return null;}};
  return async(input,init={})=>{
    if(typeof input!=='string'||!(input==='/api'||input.startsWith('/api/')))return fetchImpl(input,init);
    const captured=read(),headers=new Headers(init.headers||{});
    if(!headers.has('Authorization')&&captured)headers.set('Authorization',`Bearer ${captured.token}`);
    const bound=captured&&headers.get('Authorization')===`Bearer ${captured.token}`?captured:null;
    const response=await fetchImpl(`${apiBase}${input}`,{...init,headers});
    const path=input.split('?')[0];
    if(response.status!==401||['/api/login','/api/login/google'].includes(path))return response;
    if(['/api/usuarios/perfil','/api/usuarios/password'].includes(path)) {
      try {if((await response.clone().json())?.code==='current_password_invalid')return response;}catch{/* An unclassified 401 remains unauthorized. */}
    }
    const current=read();
    if(bound&&current?.token===bound.token&&current.usuario.id===bound.usuario.id&&current.usuario.rol===bound.usuario.rol){
      storage.removeItem('render_sesion');
      if(location.pathname!=='/login')location.replace(loginHrefForDestination(`${location.pathname}${location.search || ''}${location.hash || ''}`));
    }
    return response;
  };
}
