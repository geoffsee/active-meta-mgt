import React from 'react';
import { Patient, Evaluation } from '../api';
import SpecialistGrid from './SpecialistGrid';
import StructuredFindings from './StructuredFindings';

interface CaseDetailProps {
  patient: Patient;
  evaluations: Evaluation[];
  onEvaluate: (options?: any) => void;
}

const CaseDetail: React.FC<CaseDetailProps> = ({ patient, evaluations, onEvaluate }) => {
  const structuredData = patient.findings ? {
    findings: patient.findings.filter(f => f.type === 'finding'),
    conflicts: patient.findings.filter(f => f.type === 'conflict'),
    followups: patient.findings.filter(f => f.type === 'followup'),
  } : null;

  return (
    <div className="case-detail visible">
      <div className="case-header">
        <div>
          <h2>{patient.primaryDiagnosis}</h2>
          <div className="meta">
            <span>ID: {patient.patientId}</span>
            {patient.age && <span>Age: {patient.age}</span>}
            {patient.gender && <span>Gender: {patient.gender}</span>}
            {patient.criticality && <span className="crit">{patient.criticality}</span>}
          </div>
        </div>
        <button onClick={() => onEvaluate()}>Evaluate Case</button>
      </div>

      {patient.dataQuality && (
        <div className="data-quality">
          <h4>Data Completeness</h4>
          <div className="bar">
            <div className="bar-fill" style={{ width: `${patient.dataQuality.score * 100}%` }}></div>
          </div>
          <div className="gaps">
            {patient.dataQuality.gaps.map((gap, i) => (
              <span key={i} className="gap-item">{gap}</span>
            ))}
          </div>
        </div>
      )}

      <div className="clinical-grid">
        <ClinicalSection title="Summary" content={patient.summary} />
        <ClinicalSection title="Vitals" data={patient.vitals} />
        <ClinicalSection title="Labs" data={patient.labs} />
        <ClinicalSection title="Medications" list={patient.meds} />
        <ClinicalSection title="Imaging" list={patient.imaging} />
      </div>

      {evaluations.length > 0 && (
        <div className="eval-section">
          <h3>Specialist Evaluations</h3>
          <SpecialistGrid evaluations={evaluations} />
        </div>
      )}

      {structuredData && (
        <div className="eval-section">
          <h3>Structured Clinical Insights</h3>
          <StructuredFindings data={structuredData as any} />
        </div>
      )}
    </div>
  );
};

interface ClinicalSectionProps {
  title: string;
  content?: string;
  data?: Record<string, any>;
  list?: string[];
}

const ClinicalSection: React.FC<ClinicalSectionProps> = ({ title, content, data, list }) => {
  return (
    <div className="clinical-section">
      <h3>
        {title} 
        {list && <span className="count">{list.length}</span>}
      </h3>
      <div className="clinical-data">
        {content && <p>{content}</p>}
        {data && Object.entries(data).map(([key, value]) => (
          <div key={key} className="row">
            <span className="label">{key}</span>
            <span className="value">{String(value)}</span>
          </div>
        ))}
        {list && list.map((item, i) => (
          <span key={i} className="pill">{item}</span>
        ))}
        {!content && !data && !list && <span className="none">No data available</span>}
      </div>
    </div>
  );
};

export default CaseDetail;
