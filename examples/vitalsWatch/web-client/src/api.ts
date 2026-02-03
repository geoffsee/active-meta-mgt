export interface Patient {
  patientId: string;
  primaryDiagnosis: string;
  age?: number;
  gender?: string;
  summary?: string;
  vitals?: Record<string, any>;
  labs?: Record<string, any>;
  meds?: string[];
  imaging?: string[];
  findings?: any[];
  isEvaluated?: boolean;
  criticality?: 'critical' | 'high' | 'normal';
  dataQuality?: {
    score: number;
    gaps: string[];
  };
}

export interface Evaluation {
  specialist: string;
  status: 'pending' | 'loading' | 'success' | 'error';
  content?: string;
  error?: string;
  context?: string;
}

export interface StructuredOutput {
  findings: Array<{
    title: string;
    description: string;
    severity: string;
    confidence: string;
    tags: string[];
  }>;
  conflicts: Array<{
    description: string;
    resolution: string;
  }>;
  followups: Array<{
    description: string;
    priority: string;
  }>;
}

export const api = {
  async getPatients(): Promise<Patient[]> {
    const res = await fetch('/api/patients');
    if (!res.ok) throw new Error('Failed to fetch patients');
    return res.json();
  },

  async getPatient(id: string): Promise<Patient> {
    const res = await fetch(`/api/patients/${id}`);
    if (!res.ok) throw new Error('Failed to fetch patient');
    return res.json();
  },

  async ingestPatient(data: Partial<Patient>): Promise<Patient & { credentials?: any }> {
    const res = await fetch('/api/ingest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error('Failed to ingest patient');
    return res.json();
  },

  async evaluate(patientId: string, options: any = {}): Promise<Evaluation[]> {
    const res = await fetch('/api/evaluate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ patientId, ...options }),
    });
    if (!res.ok) throw new Error('Failed to evaluate');
    return res.json();
  },

  async getVersions() {
    const res = await fetch('/api/versions');
    if (!res.ok) throw new Error('Failed to fetch versions');
    return res.json();
  }
};
