// A successful recovery removes its invoker. Restore a usable form control
// only if closing the dialog left BODY focused; never steal later user focus.
export function restoreProductionDraftRecoveryFocus(result,{form,invoker}) {
  if(typeof result!=='boolean'||!form?.isConnected)return false;
  const document=form.ownerDocument;
  if(document?.activeElement!==document?.body||document?.querySelector('dialog[open]'))return false;
  const candidates=result?[...form.querySelectorAll('input,textarea,select,button,[tabindex]'),invoker]:[invoker];
  const target=candidates.find(element=>element?.isConnected&&element.tabIndex>=0&&!element.disabled
    &&!element.matches(':disabled')&&!element.closest('[inert],[hidden],[aria-hidden="true"]')
    &&element.getClientRects().length>0);
  if(!target)return false;
  try{target.focus({preventScroll:true});return document.activeElement===target;}catch{return false;}
}
