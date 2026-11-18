import { useState } from 'react';
import Alert from '../common/Alert';

export default function CommentForm({ onSubmit }) {
  const [message, setMessage] = useState('');
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!message.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await onSubmit(message.trim());
      setMessage('');
    } catch (err) {
      setError(err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className="comment-form" onSubmit={handleSubmit}>
      <Alert error={error} onClose={() => setError(null)} />
      <textarea
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        placeholder="Write a reply… (staff replies count as SLA responses)"
        rows={3}
        maxLength={5000}
        required
      />
      <div className="form-actions">
        <button type="submit" className="btn btn-primary" disabled={saving || !message.trim()}>
          {saving ? 'Posting…' : 'Add comment'}
        </button>
      </div>
    </form>
  );
}
