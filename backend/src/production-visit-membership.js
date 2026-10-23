// Shared operational membership, not a grant to edit a visit or its tasks.
// Callers keep their date/client/source visibility filters and supply their
// existing live-task scope. UNION prevents one visit/video from counting twice.
export function productionVisitMembersSql(visitAlias, visibleTask) {
  if (typeof visitAlias !== 'string' || visitAlias.trim() !== visitAlias || !/^[a-z_][a-z0-9_]*$/i.test(visitAlias)
    || typeof visibleTask !== 'function') throw new TypeError('Invalid visit membership SQL scope');
  return `SELECT visit_participant.usuario_id
    FROM produccion_visita_participantes visit_participant
    WHERE visit_participant.visita_id=${visitAlias}.id
    UNION SELECT visit_assignment.usuario_id
    FROM tarea_asignaciones visit_assignment JOIN tareas visit_source ON visit_source.id=visit_assignment.tarea_id
    WHERE visit_source.id=${visitAlias}.tarea_origen_id AND (${visibleTask('visit_source')})
    UNION SELECT editing_assignment.usuario_id
    FROM produccion_videos visit_video
    JOIN tareas visit_editing ON visit_editing.id=COALESCE(visit_video.tarea_entrega_id,visit_video.tarea_edicion_id)
    JOIN tarea_asignaciones editing_assignment ON editing_assignment.tarea_id=visit_editing.id
    WHERE visit_video.visita_id=${visitAlias}.id AND (${visibleTask('visit_editing')})`;
}
