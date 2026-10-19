import React from 'react';
import { getRecordedTaskContext, safeMaterialUrl } from './taskRecordedContext.js';

export function TaskRecordedContext({ task }) {
  const rows = getRecordedTaskContext(task);
  if (!rows) return null;

  return <section className="ros-work-block ros-recorded-context">
    <h3>Material y coordinación</h3>
    <dl>
      {rows.map(row => <div key={row.key}>
        <dt>{row.label}</dt>
        <dd>{row.values.map((value, index) => {
          const href = row.key === 'material' ? safeMaterialUrl(value) : null;
          return <p key={index}>{href
            ? <a href={href} target="_blank" rel="noopener noreferrer">{value}</a>
            : value}</p>;
        })}</dd>
      </div>)}
    </dl>
  </section>;
}

export default TaskRecordedContext;
