export const MONTHLY_ADJUSTMENT_ACTION='monthly_count_adjustment_v1';
export const validMonthlyKey=k=>typeof k==='string'&&/^(cliente|grupo)-[1-9]\d{0,9}$/.test(k)&&Number(k.split('-')[1])<=2147483647;
export const validMonthlyPeriod=p=>typeof p==='string'&&/^20\d\d-(0[1-9]|1[0-2])$/.test(p);
export const validMonthlyCount=n=>Number.isSafeInteger(n)&&n>=0&&n<=10000;
export function monthlyAdjustment(value,{key,period,memberIds}={}){
 if(!value||Array.isArray(value)||value.version!==1||!validMonthlyKey(value.key)||!validMonthlyPeriod(value.period)
   ||key!==undefined&&value.key!==key||period!==undefined&&value.period!==period
   ||!['manual','automatic'].includes(value.mode)||typeof value.revision!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value.revision)
   ||typeof value.checkedAt!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value.checkedAt)||!Number.isFinite(Date.parse(value.checkedAt))
   ||!Array.isArray(value.memberIds)||!value.memberIds.length||value.memberIds.some(id=>!Number.isSafeInteger(id)||id<1||id>2147483647)
   ||new Set(value.memberIds).size!==value.memberIds.length
   ||value.mode==='manual'&&(!validMonthlyCount(value.reels)||!validMonthlyCount(value.carruseles)))return null;
 const ids=[...value.memberIds].sort((a,b)=>a-b);
 if(memberIds&&JSON.stringify(ids)!==JSON.stringify([...memberIds].sort((a,b)=>a-b)))return null;
 return {version:1,key:value.key,period:value.period,mode:value.mode,memberIds:ids,revision:value.revision,checkedAt:value.checkedAt,
   ...(value.mode==='manual'?{reels:value.reels,carruseles:value.carruseles}:{})};
}
export function groupMonthlyAdjustment(clients,period){
 if(!clients.length)return null;
 const first=clients[0],key=first.grupo_feed_id?`grupo-${first.grupo_feed_id}`:`cliente-${first.id}`;
 const values=clients.map(c=>monthlyAdjustment(c.instagram_monthly_adjustment,{key,period,memberIds:clients.map(c=>c.id)}));
 if(values.some(v=>!v)||new Set(values.map(v=>v.revision)).size!==1)return null;
 return values[0];
}
