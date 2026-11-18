import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import ticketService from '../services/ticketService';
import memberService from '../services/memberService';
import Alert from '../components/common/Alert';
import { PRIORITY_LABELS } from '../utils/format';

export default function CreateTicket() {
  const navigate = useNavigate();
  const [form, setForm] = useState({
    title: '', description: '', priority: 'medium', assigneeId: '',
  });
  const [staff, setStaff] = useState([]);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    memberService.directory().then((m) => setStaff(m.filter((x) => x.role !== 'viewer'))).catch(() => {});
  }, []);

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const ticket = await ticketService.create({
        title: form.title,
        description: form.description,
        priority: form.priority,
        assigneeId: form.assigneeId ? Number(form.assigneeId) : null,
      });
      navigate(`/tickets/${ticket.id}`);
    } catch (err) {
      setError(err);
      setSaving(false);
    }
  };

  const monitored = form.priority === 'high' || form.priority === 'urgent';

  return (
    <div className="page page-narrow">
      <h1>New ticket</h1>
      <form className="form card" onSubmit={handleSubmit}>
        <Alert error={error} onClose={() => setError(null)} />
        <label>
          Title
          <input value={form.title} onChange={set('title')} maxLength={200} required autoFocus />
        </label>
        <label>
          Description
          <textarea value={form.description} onChange={set('description')} rows={6} maxLength={10000} required />
        </label>
        <div className="form-row">
          <label>
            Priority
            <select value={form.priority} onChange={set('priority')}>
              {Object.entries(PRIORITY_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
          <label>
            Assignee (optional)
            <select value={form.assigneeId} onChange={set('assigneeId')}>
              <option value="">Unassigned</option>
              {staff.map((m) => <option key={m.id} value={m.id}>{m.name} ({m.role})</option>)}
            </select>
          </label>
        </div>
        {monitored && (
          <Alert type="info">High and urgent tickets are SLA-monitored: a staff reply is expected within your organization&apos;s response time.</Alert>
        )}
        <div className="form-actions">
          <button type="button" className="btn btn-secondary" onClick={() => navigate(-1)}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Creating…' : 'Create ticket'}</button>
        </div>
      </form>
    </div>
  );
}
