import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import Alert from '../components/common/Alert';

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [form, setForm] = useState({ email: '', password: '' });
  const [organizations, setOrganizations] = useState(null);
  const [organizationId, setOrganizationId] = useState('');
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await login({ ...form, organizationId: organizationId ? Number(organizationId) : undefined });
      navigate(location.state?.from?.pathname || '/', { replace: true });
    } catch (err) {
      // Same email in several organizations: let the user pick one.
      if (err.errorCode === 'ORGANIZATION_SELECTION_REQUIRED') {
        setOrganizations(err.details.organizations);
        setOrganizationId(String(err.details.organizations[0].id));
      } else {
        setError(err);
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="auth-page">
      <form className="auth-card" onSubmit={handleSubmit}>
        <div className="auth-brand"><span className="brand-mark">S</span> SliqDesk</div>
        <h1>Sign in</h1>
        <Alert error={error} onClose={() => setError(null)} />
        <label>
          Email
          <input type="email" autoComplete="email" value={form.email} onChange={set('email')} required />
        </label>
        <label>
          Password
          <input type="password" autoComplete="current-password" value={form.password} onChange={set('password')} required />
        </label>
        {organizations && (
          <label>
            Organization
            <select value={organizationId} onChange={(e) => setOrganizationId(e.target.value)}>
              {organizations.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          </label>
        )}
        <button type="submit" className="btn btn-primary btn-block" disabled={saving}>
          {saving ? 'Signing in…' : 'Sign in'}
        </button>
        <p className="muted center">
          New to SliqDesk? <Link to="/signup">Create an organization</Link>
        </p>
      </form>
    </div>
  );
}
