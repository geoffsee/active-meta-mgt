import React from 'react';
import { StructuredOutput } from '../api';

interface StructuredFindingsProps {
  data: StructuredOutput;
}

const StructuredFindings: React.FC<StructuredFindingsProps> = ({ data }) => {
  return (
    <div className="structured">
      <div className="structured-row">
        <div className="panel">
          <div className="panel-header">
            <span>Key Clinical Findings</span>
            <span>{data.findings.length} total</span>
          </div>
          <div className="panel-body">
            {data.findings.map((f, i) => (
              <div key={i} className="finding">
                <div className="title">{f.title}</div>
                <div className="meta">
                  <span className={`tag sev-${f.severity.toLowerCase()}`}>{f.severity}</span>
                  <span className={`tag conf-${f.confidence.toLowerCase()}`}>{f.confidence} Confidence</span>
                </div>
                <div className="description">{f.description}</div>
                {f.tags && (
                  <div style={{ marginTop: '8px' }}>
                    {f.tags.map((t, j) => (
                      <span key={j} className="tag" style={{ marginRight: '4px' }}>{t}</span>
                    ))}
                  </div>
                )}
              </div>
            ))}
            {data.findings.length === 0 && <div className="empty-note">No findings identified.</div>}
          </div>
        </div>

        <div className="panel">
          <div className="panel-header">
            <span>Conflicts / Uncertainties</span>
          </div>
          <div className="panel-body">
            {data.conflicts.map((c, i) => (
              <div key={i} className="conflict">
                <div className="description"><strong>Issue:</strong> {c.description}</div>
                <div className="resolution" style={{ marginTop: '4px', color: '#999' }}>
                  <strong>Resolution:</strong> {c.resolution}
                </div>
              </div>
            ))}
            {data.conflicts.length === 0 && <div className="empty-note">No conflicts identified.</div>}
          </div>
        </div>

        <div className="panel">
          <div className="panel-header">
            <span>Follow-up Actions</span>
          </div>
          <div className="panel-body">
            {data.followups.map((f, i) => (
              <div key={i} className="followup">
                <div>{f.description}</div>
                <div className="tag" style={{ marginTop: '4px' }}>{f.priority} Priority</div>
              </div>
            ))}
            {data.followups.length === 0 && <div className="empty-note">No follow-ups identified.</div>}
          </div>
        </div>
      </div>
    </div>
  );
};

export default StructuredFindings;
