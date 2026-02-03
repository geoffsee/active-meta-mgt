import React from 'react';
import { Evaluation } from '../api';

interface SpecialistGridProps {
  evaluations: Evaluation[];
}

const SpecialistGrid: React.FC<SpecialistGridProps> = ({ evaluations }) => {
  return (
    <div className="specialist-grid">
      {evaluations.map((ev, i) => (
        <div key={i} className={`specialist-card ${ev.status}`}>
          <div className="specialist-header">
            <span className="icon">{getIcon(ev.specialist)}</span>
            <span className="title">{ev.specialist}</span>
            <span className={`status ${ev.status}`}>{ev.status}</span>
          </div>
          <div className={`specialist-body ${!ev.content ? 'empty' : ''}`}>
            {ev.content || (ev.status === 'loading' ? 'Evaluating...' : 'Waiting for results...')}
            {ev.error && <div className="error-text">{ev.error}</div>}
          </div>
          {ev.context && (
            <details className="specialist-context">
              <summary>View Prompt Context</summary>
              <pre>{ev.context}</pre>
            </details>
          )}
        </div>
      ))}
    </div>
  );
};

function getIcon(specialist: string) {
  const icons: Record<string, string> = {
    'Emergency Medicine': '🚑',
    'Cardiology': '🫀',
    'Pulmonology': '🫁',
    'Internal Medicine': '🩺',
    'Infectious Disease': '🦠',
    'Radiology': '☢️',
    'Coordinator': '📋'
  };
  return icons[specialist] || '🧑‍⚕️';
}

export default SpecialistGrid;
