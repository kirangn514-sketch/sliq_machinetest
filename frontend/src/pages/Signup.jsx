import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import Alert from '../components/common/Alert';

export default function Signup() {
  const { signup } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({
    organizationName: '', name: '', email: '', password: '', confirm: '',
  });
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (form.password !== form.confirm) {
      setError('Passwords do not match');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const { confirm, ...payload } = form;
      await signup(payload);
      navigate('/', { replace: true });
    } catch (err) {
      setError(err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="auth-page">
      <form className="auth-card" onSubmit={handleSubmit}>
        <div className="auth-brand"><span className="brand-mark">S</span> SliqDesk</div>
        <h1>Create your organization</h1>
        <p className="muted">You will be the organization&apos;s first admin.</p>
        <Alert error={error} onClose={() => setError(null)} />
        <label>
          Organization name
          <input value={form.organizationName} onChange={set('organizationName')} minLength={2} maxLength={150} required />
        </label>
        <label>
          Your name
          <input value={form.name} onChange={set('name')} maxLength={100} autoComplete="name" required />
        </label>
        <label>
          Email
          <input type="email" value={form.email} onChange={set('email')} maxLength={150} autoComplete="email" required />
        </label>
        <label>
          Password
          <input type="password" value={form.password} onChange={set('password')} minLength={8} autoComplete="new-password" required />
          <span className="hint">At least 8 characters, including a letter and a number.</span>
        </label>
        <label>
          Confirm password
          <input type="password" value={form.confirm} onChange={set('confirm')} autoComplete="new-password" required />
        </label>
        <button type="submit" className="btn btn-primary btn-block" disabled={saving}>
          {saving ? 'Creating…' : 'Create organization'}
        </button>
        <p className="muted center">
          Already have an account? <Link to="/login">Sign in</Link>
        </p>
      </form>
    </div>
  );
}
