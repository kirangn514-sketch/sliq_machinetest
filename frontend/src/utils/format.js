export const STATUS_LABELS = {
  open: 'Open', in_progress: 'In progress', resolved: 'Resolved', closed: 'Closed',
};
export const PRIORITY_LABELS = {
  low: 'Low', medium: 'Medium', high: 'High', urgent: 'Urgent',
};
export const ROLE_LABELS = { admin: 'Admin', agent: 'Agent', viewer: 'Viewer' };

export const ROLE_DESCRIPTIONS = {
  admin: 'Full access: tickets, members and settings',
  agent: 'Create tickets, comment, update own or unassigned tickets',
  viewer: 'Read-only access to tickets and comments',
};

export function formatDate(value) {
  if (!value) return '—';
  return new Date(value).toLocaleString(undefined, {
    year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit',
  });
}

export function relativeTime(value) {
  if (!value) return '';
  const diffSec = Math.round((new Date(value).getTime() - Date.now()) / 1000);
  const abs = Math.abs(diffSec);
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  if (abs < 60) return rtf.format(diffSec, 'second');
  if (abs < 3600) return rtf.format(Math.round(diffSec / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(diffSec / 3600), 'hour');
  return rtf.format(Math.round(diffSec / 86400), 'day');
}
