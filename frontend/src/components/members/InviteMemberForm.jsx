import { useState } from 'react';
import Alert from '../common/Alert';
import { ROLE_LABELS, ROLE_DESCRIPTIONS } from '../../utils/format';

const EMPTY = { name: '', email: '', role: 'agent' };

export default function InviteMemberForm({ onInvite }) {
  const [form, setForm] = useState(EMPTY);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setResult(null);
    setCopied(false);
    try {
      const data = await onInvite(form);
      setResult(data);
      setForm(EMPTY);
    } catch (err) {
      setError(err);
    } finally {
      setSaving(false);
    }
  };

  const copy = async () => {
    await navigator.clipboard.writeText(result.invitationUrl);
    setCopied(true);
  };

  return (
    <form className="form card" onSubmit={handleSubmit}>
      <h3>Invite a member</h3>
      <Alert error={error} onClose={() => setError(null)} />
      <div className="form-row">
        <label>
          Name
          <input value={form.name} onChange={set('name')} maxLength={100} required />
        </label>
        <label>
          Email
          <input type="email" value={form.email} onChange={set('email')} maxLength={150} required />
        </label>
        <label>
          Role
          <select value={form.role} onChange={set('role')}>
            {Object.entries(ROLE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
      </div>
      <p className="muted small">{ROLE_DESCRIPTIONS[form.role]}</p>
      <div className="form-actions">
        <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Inviting…' : 'Send invitation'}</button>
      </div>
      {result && (
        <div className="alert alert-success invite-result">
          <div>
            <div>Invitation created for <strong>{result.invitation.email}</strong>.</div>
            {result.invitationUrl ? (
              <>
                <div className="small">Development mode: share this one-time link (no email service configured).</div>
                <div className="invite-link">
                  <code>{result.invitationUrl}</code>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={copy}>{copied ? 'Copied' : 'Copy'}</button>
                </div>
              </>
            ) : (
              <div className="small">The invitation link is delivered out of band in production.</div>
            )}
          </div>
        </div>
      )}
    </form>
  );
}
