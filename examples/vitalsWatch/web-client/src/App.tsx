import React, { useState, useEffect } from 'react';
import { api, Patient, Evaluation } from './api';
import Drawer from './components/Drawer';
import CaseDetail from './components/CaseDetail';
import AddCaseModal from './components/AddCaseModal';

const App: React.FC = () => {
  const [patients, setPatients] = useState<Patient[]>([]);
  const [selectedPatientId, setSelectedPatientId] = useState<string | null>(null);
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null);
  const [evaluations, setEvaluations] = useState<Record<string, Evaluation[]>>({});
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadPatients();
  }, []);

  useEffect(() => {
    if (selectedPatientId) {
      loadPatient(selectedPatientId);
    } else {
      setSelectedPatient(null);
    }
  }, [selectedPatientId]);

  const loadPatients = async () => {
    try {
      setLoading(true);
      const data = await api.getPatients();
      setPatients(data);
    } catch (error) {
      console.error('Failed to load patients', error);
    } finally {
      setLoading(false);
    }
  };

  const loadPatient = async (id: string) => {
    try {
      const data = await api.getPatient(id);
      setSelectedPatient(data);
    } catch (error) {
      console.error('Failed to load patient', error);
    }
  };

  const handleSelectPatient = (id: string) => {
    setSelectedPatientId(id);
    setIsDrawerOpen(false);
  };

  const handleAddSuccess = (patient: Patient) => {
    setIsAddModalOpen(false);
    loadPatients();
    setSelectedPatientId(patient.patientId);
  };

  return (
    <div className="app">
      <div className={`drawer-tab ${isDrawerOpen ? 'open' : ''}`} onClick={() => setIsDrawerOpen(true)}>
        <h1>Cases (<span>{patients.length}</span>) <span className="demo-badge">Demo</span></h1>
        <span className="arrow">▼</span>
      </div>

      <Drawer 
        isOpen={isDrawerOpen} 
        onClose={() => setIsDrawerOpen(false)}
        patients={patients}
        selectedPatientId={selectedPatientId}
        onSelectPatient={handleSelectPatient}
        onRefresh={loadPatients}
        onAddCase={() => setIsAddModalOpen(true)}
      />

      <AddCaseModal 
        isOpen={isAddModalOpen}
        onClose={() => setIsAddModalOpen(false)}
        onSuccess={handleAddSuccess}
      />

      <main>
        {selectedPatient ? (
          <CaseDetail 
            patient={selectedPatient} 
            evaluations={evaluations[selectedPatient.patientId] || []}
            onEvaluate={async (options) => {
              // Logic for evaluation
              const evals = await api.evaluate(selectedPatient.patientId, options);
              setEvaluations(prev => ({ ...prev, [selectedPatient.patientId]: evals }));
              loadPatient(selectedPatient.patientId);
              loadPatients();
            }}
          />
        ) : (
          <div className="empty">
            <div className="stats">
              <div className="stat">
                <div className="value">{patients.length}</div>
                <div className="label">Total Cases</div>
              </div>
              <div className="stat">
                <div className="value">{patients.filter(p => p.isEvaluated).length}</div>
                <div className="label">Evaluated</div>
              </div>
            </div>
            <p>Select a case from the menu to begin evaluation</p>
            <div className="actions" style={{ justifyContent: 'center' }}>
              <button onClick={() => setIsDrawerOpen(true)}>Open Cases</button>
              <button className="secondary" onClick={() => setIsAddModalOpen(true)}>Add New Case</button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
};

export default App;
