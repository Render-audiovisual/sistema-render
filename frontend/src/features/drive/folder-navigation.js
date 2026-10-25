import { dispatchNavigationEvent } from '../../shared/navigation/unsaved.js';

// Folder changes replace the keyed uploader without changing the URL. Ask the
// same installed guards as a data refresh, never mutate browser history here.
export function requestDriveFolderChange(win) {
  return dispatchNavigationEvent(win,new win.CustomEvent('render:before-navigation',{
    detail:{href:win.location.href,type:'refresh'},cancelable:true,
  }));
}
