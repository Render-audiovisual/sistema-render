import {dispatchNavigationEvent} from './unsaved.js';

// Explicit same-document recovery. Respect unsaved/busy guards and revalidate
// identity/route after every listener; never reload or replay a write.
export function requestSectionRetry(win,{isCurrent,retry}){
 if(typeof isCurrent!=='function'||typeof retry!=='function'||!isCurrent())return false;
 const from=win.location.href;
 const event=new win.CustomEvent('render:before-navigation',{detail:{href:`${win.location.pathname}${win.location.search}${win.location.hash}`,type:'refresh'},cancelable:true});
 if(!dispatchNavigationEvent(win,event)||win.location.href!==from||!isCurrent())return false;
 retry();return true;
}
