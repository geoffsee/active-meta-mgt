import React, { useState } from 'react';
import { api, Patient } from '../api';

interface AddCaseModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (patient: Patient, credentials?: any) => void;
}

const AddCaseModal: React.FC<AddCaseModalProps> = ({ isOpen, onClose, onSuccess }) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const formData = new FormData(e.currentTarget);
    const data = Object.fromEntries(formData.entries());

    try {
      const result = await api.ingestPatient(data as any);
      onSuccess(result, result.credentials);
    } catch (err: any) {
      setError(err.message || 'Failed to add case');
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="modal-backdrop visible">
      <div className="modal">
        <div className="modal-header">
          <div>
            <div className="modal-title">Add Case</div>
            <div className="modal-subtitle">Creates a new patient entry</div>
          </div>
          <button className="drawer-close" onClick={onClose}>×</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            <div className="form-grid">
              <div className="field">
                <label>Patient ID</label>
                <input name="patientId" type="text" placeholder="auto-generate if empty" />
              </div>
              <div className="field">
                <label>Primary Diagnosis</label>
                <input name="primaryDiagnosis" type="text" placeholder="e.g. Sepsis" required />
              </div>
              <div className="field">
                <label>Age</label>
                <input name="age" type="number" placeholder="e.g. 65" />
              </div>
              <div className="field">
                <label>Gender</label>
                <select name="gender">
                  <option value="">Select...</option>
                  <option value="Male">Male</option>
                  <option value="Female">Female</option>
                  <option value="Other">Other</option>
                </select>
              </div>
            </div>
            <div className="field">
              <label>Summary / HPI</label>
              <textarea name="summary" placeholder="Clinical summary..."></textarea>
            </div>
            {error && <div className="error-text">{error}</div>}
          </div>
          <div className="modal-actions">
            <button type="button" className="secondary" onClick={onClose}>Cancel</button>
            <button type="submit" disabled={loading}>{loading ? 'Adding...' : 'Add Case'}</button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default AddCaseModal;
