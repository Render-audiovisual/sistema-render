import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createMoodboardTaskPager, mergeMoodboardTasks } from './moodboardTaskPager.js';
import './MoodboardTaskPicker.css';

export function MoodboardTaskPicker({ boardId, tasks, linkedTasks, capture, disabled, isLinked, toggle }) {
  const mounted = useRef(false), holder = useRef(null), [, paint] = useState(0);
  useLayoutEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  // Parent renders create equivalent capture functions; the captured guard
  // already binds identity/board lifetime. Do not discard pages on busy paints.
  if (!holder.current || holder.current.boardId !== boardId || holder.current.tasks !== tasks) {
    const entry = { boardId, tasks, capture, model: null };
    entry.model = createMoodboardTaskPager({ boardId, initial: tasks,
      capture: () => capture(() => mounted.current && holder.current === entry),
      onChange: () => { if (mounted.current && holder.current === entry) paint(value => value + 1); } });
    holder.current = entry;
  }
  const entry = holder.current, state = entry.model.snapshot;
  useEffect(() => () => entry.model.cancel(), [entry]);
  const visible = mergeMoodboardTasks(state.items, linkedTasks || []);
  return <div className="moodboard-task-picker">
    <div className="moodboard-task-links">{visible.map(task => <label key={task.id}>
      <input type="checkbox" disabled={disabled} checked={isLinked(task.id)} onChange={() => toggle(task)} />
      <span>{task.titulo}</span>
    </label>)}</div>
    {state.error && <p role="alert" className="moodboard-error">{state.error}</p>}
    {state.nextOffset !== null && <button className="moodboard-task-more" type="button" disabled={disabled || state.busy}
      onClick={() => void entry.model.loadMore()}>{state.busy ? 'Cargando tareas…' : state.error ? 'Reintentar carga de tareas' : 'Cargar más tareas'}</button>}
  </div>;
}
