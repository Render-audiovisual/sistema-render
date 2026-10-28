import React from 'react';
import { Modal } from '../components/Modal.jsx';
import { storyWorkStateLabel } from './storyWorkStateLabel.js';
import './StoryWorkPanel.css';

export function StoryWorkPanel({ story, clientName, states, disabled, onChange, onClose }) {
  return <Modal native overlayClassName="story-work-overlay" className="story-work-panel" title={`Historia #${story.id}`} onClose={onClose}>
    <div className="story-work-content">
      <p>{clientName || `Cliente #${story.cliente_id}`} · {story.fecha_programada}</p>
      <h2>{story.idea || 'Historia sin título'}</h2>
      <label>Estado de trabajo<select aria-label={`Estado de trabajo · historia #${story.id}`} value={story.estado} disabled={disabled}
        onChange={event => {
          const estado = event.target.value;
          if (!disabled && estado !== 'publicada' && states.some(state => state.id === estado)) onChange(story.id, { estado });
        }}>
        {states.map(state => <option key={state.id} value={state.id} disabled={state.id === 'publicada'}>{storyWorkStateLabel(state)}</option>)}
      </select></label>
      <p className="story-work-hint">El estado se guarda en la historia. No registra una publicación.</p>
      {story.copy && <section><h3>Texto / copy</h3><p className="story-work-copy">{story.copy}</p></section>}
      {story.aclaraciones && <section><h3>Notas</h3><p className="story-work-copy">{story.aclaraciones}</p></section>}
    </div>
  </Modal>;
}
