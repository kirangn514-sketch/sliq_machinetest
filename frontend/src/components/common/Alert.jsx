/** Inline message box. `error` may be an ApiError, a string, or null. */
export default function Alert({ type = 'error', error, children, onClose }) {
  const message = children || (error && (error.message || String(error)));
  if (!message) return null;
  const fields = error && error.fields ? Object.values(error.fields) : [];
  return (
    <div className={`alert alert-${type}`} role={type === 'error' ? 'alert' : 'status'}>
      <div>
        <div>{message}</div>
        {fields.length > 0 && (
          <ul className="alert-fields">
            {fields.map((f) => <li key={f}>{f}</li>)}
          </ul>
        )}
      </div>
      {onClose && (
        <button type="button" className="alert-close" onClick={onClose} aria-label="Dismiss">×</button>
      )}
    </div>
  );
}
