import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import authService from '../services/authService';
import Alert from '../components/common/Alert';
import Loading from '../components/common/Loading';
import { ROLE_LABELS } from '../utils/format';

/** The invitation token travels in the URL fragment (#token=...) so it never reaches server logs. */
export default function AcceptInvite() {
  const { acceptInvitation } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const token = useMemo(() => new URLSearchParams(location.hash.slice(1)).get('token') || '', [location.hash]);

  const [invite, setInvite] = useState(null);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ password: '', confirm: '' });
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!token) {
      setError('This invitation link is incomplete.');
      setLoading(false);
      return;
    }
    authService.previewInvitation(token)
      .then(setInvite)
      .catch(setError)
      .finally(() => setLoading(false));
  }, [token]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (form.password !== form.confirm) {
      setError('Passwords do not match');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await acceptInvitation({ token, password: form.password });
      window.history.replaceState(null, '', '/'); // drop the token from history
      navigate('/', { replace: true });
    } catch (err) {
      setError(err);
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <Loading label="Checking invitation…" />;

  return (
    <div className="auth-page">
      <form className="auth-card" onSubmit={handleSubmit}>
        <div className="auth-brand"><span className="brand-mark">S</span> SliqDesk</div>
        <h1>Join your team</h1>
        <Alert error={error} />
        {invite ? (
          <>
            <p>
              <strong>{invite.name}</strong> ({invite.email}), you have been invited to
              {' '}<strong>{invite.organizationName}</strong> as <strong>{ROLE_LABELS[invite.role]}</strong>.
            </p>
            <label>
              Choose a password
              <input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} minLength={8} autoComplete="new-password" required />
              <span className="hint">At least 8 characters, including a letter and a number.</span>
            </label>
            <label>
              Confirm password
              <input type="password" value={form.confirm} onChange={(e) => setForm({ ...form, confirm: e.target.value })} autoComplete="new-password" required />
            </label>
            <button type="submit" className="btn btn-primary btn-block" disabled={saving}>
              {saving ? 'Joining…' : 'Accept invitation'}
            </button>
          </>
        ) : (
          <p className="muted center"><Link to="/login">Go to sign in</Link></p>
        )}
      </form>
    </div>
  );
}
