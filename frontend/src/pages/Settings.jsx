import { useEffect, useState } from 'react';
import settingsService from '../services/settingsService';
import Alert from '../components/common/Alert';
import Loading from '../components/common/Loading';
import { formatDate } from '../utils/format';

export default function Settings() {
  const [sla, setSla] = useState(null);
  const [minutes, setMinutes] = useState('');
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    settingsService.getSla()
      .then((s) => { setSla(s); setMinutes(String(s.responseTimeMinutes)); })
      .catch(setError);
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const updated = await settingsService.updateSla(Number(minutes));
      setSla(updated);
      setNotice('SLA response time saved. It applies to SLA timers started from now on.');
    } catch (err) {
      setError(err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="page page-narrow">
      <h1>Settings</h1>
      {!sla && !error ? <Loading /> : (
        <form className="form card" onSubmit={handleSubmit}>
          <h2>SLA response time</h2>
          <p className="muted">
            High and urgent tickets must receive a reply from an admin or agent within this time,
            otherwise they are flagged overdue and every member is notified.
          </p>
          <Alert error={error} onClose={() => setError(null)} />
          {notice && <Alert type="success" onClose={() => setNotice(null)}>{notice}</Alert>}
          <label>
            Response time (minutes)
            <input
              type="number"
              min={1}
              max={43200}
              step={1}
              value={minutes}
              onChange={(e) => setMinutes(e.target.value)}
              required
            />
            <span className="hint">Whole minutes, 1 – 43200 (30 days). Default: 5.</span>
          </label>
          <Alert type="info">
            Changing this value does not move deadlines of tickets that are already being timed;
            it applies to new, escalated and reopened high/urgent tickets.
          </Alert>
          {sla && sla.updatedAt && <p className="muted small">Last changed {formatDate(sla.updatedAt)}</p>}
          <div className="form-actions">
            <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
          </div>
        </form>
      )}
    </div>
  );
}
