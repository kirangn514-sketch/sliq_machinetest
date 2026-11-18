import { useEffect, useState } from 'react';
import Alert from '../common/Alert';
import { allowedNextStatuses } from '../../utils/permissions';
import { STATUS_LABELS, PRIORITY_LABELS } from '../../utils/format';

const toForm = (t) => ({
  title: t.title,
  description: t.description,
  status: t.status,
  priority: t.priority,
  assigneeId: t.assignee ? String(t.assignee.id) : '',
});

/** Sends only changed fields plus the version for optimistic concurrency. */
export default function TicketEditForm({ ticket, staff, onSave, onCancel }) {
  const [form, setForm] = useState(toForm(ticket));
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => { setForm(toForm(ticket)); }, [ticket]);

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));
  const statusOptions = [ticket.status, ...allowedNextStatuses(ticket.status)];

  const handleSubmit = async (e) => {
    e.preventDefault();
    const original = toForm(ticket);
    const changes = {};
    ['title', 'description', 'status', 'priority'].forEach((k) => {
      if (form[k] !== original[k]) changes[k] = form[k];
    });
    if (form.assigneeId !== original.assigneeId) changes.assigneeId = form.assigneeId ? Number(form.assigneeId) : null;
    if (Object.keys(changes).length === 0) {
      onCancel();
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSave({ ...changes, version: ticket.version });
    } catch (err) {
      setError(err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className="form card" onSubmit={handleSubmit}>
      <h3>Edit ticket</h3>
      <Alert error={error} onClose={() => setError(null)} />
      <label>
        Title
        <input value={form.title} onChange={set('title')} maxLength={200} required />
      </label>
      <label>
        Description
        <textarea value={form.description} onChange={set('description')} rows={5} maxLength={10000} required />
      </label>
      <div className="form-row">
        <label>
          Status
          <select value={form.status} onChange={set('status')}>
            {statusOptions.map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
          </select>
        </label>
        <label>
          Priority
          <select value={form.priority} onChange={set('priority')}>
            {Object.entries(PRIORITY_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
        <label>
          Assignee
          <select value={form.assigneeId} onChange={set('assigneeId')}>
            <option value="">Unassigned</option>
            {staff.map((m) => <option key={m.id} value={m.id}>{m.name} ({m.role})</option>)}
          </select>
        </label>
      </div>
      <div className="form-actions">
        <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={saving}>Cancel</button>
        <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save changes'}</button>
      </div>
    </form>
  );
}
