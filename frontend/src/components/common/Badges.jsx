import {
  STATUS_LABELS, PRIORITY_LABELS, ROLE_LABELS, formatDate, relativeTime,
} from '../../utils/format';

export function StatusBadge({ status }) {
  return <span className={`badge status-${status}`}>{STATUS_LABELS[status] || status}</span>;
}

export function PriorityBadge({ priority }) {
  return <span className={`badge priority-${priority}`}>{PRIORITY_LABELS[priority] || priority}</span>;
}

export function RoleBadge({ role }) {
  return <span className={`badge role-${role}`}>{ROLE_LABELS[role] || role}</span>;
}

export function OverdueBadge({ overdue }) {
  if (!overdue) return null;
  return <span className="badge badge-overdue" title="SLA response time breached">⚠ Overdue</span>;
}

const SLA_TEXT = {
  on_track: 'Awaiting first staff response',
  met: 'Responded within SLA',
  breached: 'SLA breached',
  stopped: 'SLA stopped (no longer monitored)',
  not_applicable: 'Not monitored (low/medium priority)',
};

export function SlaBadge({ sla }) {
  if (!sla) return null;
  const { state, dueAt } = sla;
  return (
    <span className={`badge sla-${state}`} title={dueAt ? `Deadline: ${formatDate(dueAt)}` : undefined}>
      {SLA_TEXT[state] || state}
      {state === 'on_track' && dueAt ? ` · due ${relativeTime(dueAt)}` : ''}
    </span>
  );
}
