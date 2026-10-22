const invalid=()=>Object.assign(new Error('La operación de referencia no es válida.'),{status:400});
const id=value=>{
  if(typeof value!=='string'||!/^[1-9]\d*$/.test(value)||String(Number(value))!==value||!Number.isSafeInteger(Number(value))||Number(value)>2147483647)throw invalid();
  return Number(value);
};

// Compatibility URLs translate transport only. They never manufacture an
// observed revision, an actor, or an operation UUID for an old consumer.
export function moodboardReferenceAliasInput(action,req){
  const body=req.body??{},query=req.query??{};
  if(!['create','edit','delete'].includes(action)||!body||typeof body!=='object'||Array.isArray(body)
    ||!query||typeof query!=='object'||Array.isArray(query)||Object.keys(query).length)throw invalid();
  const writable=action==='create'?['title','note','category_id','tags','external_url','image_data']:action==='edit'?['title','note','category_id','tags','status']:[];
  const allowed=['request_id',...(action==='create'?[]:['board_id','expected_revision']),...writable];
  if(Object.keys(body).some(key=>!allowed.includes(key)))throw invalid();
  const result={action};
  for(const key of ['request_id','expected_revision'])if(Object.hasOwn(body,key))result[key]=body[key];
  if(action==='create')result.board_id=id(req.params?.id);
  else{
    result.reference_id=id(req.params?.id);
    if(Object.hasOwn(body,'board_id'))result.board_id=body.board_id;
  }
  if(action!=='delete')result.fields=Object.fromEntries(writable.filter(key=>Object.hasOwn(body,key)).map(key=>[key,body[key]]));
  return result;
}

export function moodboardReferenceAliasBody(result){
  const {reference,operation}=result.body;
  if(operation.action==='delete')return {ok:true,reference,operation};
  return reference?{...reference,operation}:{id:operation.reference_id,unavailable:true,operation};
}
