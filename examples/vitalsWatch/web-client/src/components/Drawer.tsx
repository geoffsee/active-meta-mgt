import React from 'react';
import { Patient } from '../api';

interface DrawerProps {
  isOpen: boolean;
  onClose: () => void;
  patients: Patient[];
  selectedPatientId: string | null;
  onSelectPatient: (id: string) => void;
  onRefresh: () => void;
  onAddCase: () => void;
}

const Drawer: React.FC<DrawerProps> = ({ 
  isOpen, 
  onClose, 
  patients, 
  selectedPatientId, 
  onSelectPatient,
  onRefresh,
  onAddCase
}) => {
  return (
    <div className={`drawer-panel ${isOpen ? 'open' : ''}`}>
      <div className="drawer-panel-header">
        <div className="drawer-title">
          <h2>Select Case</h2>
          <div className="drawer-subtitle">Manage cases</div>
        </div>
        <div className="drawer-actions">
          <button className="secondary" onClick={onRefresh}>Refresh</button>
          <button className="add-case-btn" onClick={onAddCase}><span className="plus">+</span> Add Case</button>
          <button className="drawer-close" onClick={onClose} aria-label="Close cases panel">×</button>
        </div>
      </div>
      <div className="drawer-content">
        <ul className="case-list">
          {patients.map((patient, index) => (
            <li 
              key={patient.patientId} 
              className={`${selectedPatientId === patient.patientId ? 'active' : ''} ${patient.isEvaluated ? 'evaluated' : ''}`}
              onClick={() => onSelectPatient(patient.patientId)}
            >
              <span className="case-num">#{(index + 1).toString().padStart(2, '0')}</span>
              <span className="case-info">{patient.primaryDiagnosis}</span>
              {patient.criticality && (
                <span className={`badge ${patient.criticality}`}>
                  {patient.criticality}
                </span>
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
};

export default Drawer;
