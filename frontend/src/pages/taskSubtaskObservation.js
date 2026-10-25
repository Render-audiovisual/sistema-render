// Membership comes only from the last verified parent-bound read, never from
// completeness assumptions about a paginated/global board collection.
export function resolveTaskSubtasks(observed, tasks, parentId) {
  if (!observed) return [];
  const currentById=new Map(tasks.map(task=>[task.id,task]));
  return observed.flatMap(row=>{
    const current=currentById.get(row.id);
    const validRevision=Number.isSafeInteger(current?.revision)&&current.revision>0&&current.revision<=2147483647;
    if(validRevision&&current.revision>row.revision&&current.tarea_padre_id!==parentId)return [];
    if(validRevision&&current.revision>=row.revision&&current.tarea_padre_id===parentId)return [current];
    return [row];
  });
}
