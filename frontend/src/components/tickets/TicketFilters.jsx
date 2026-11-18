import { STATUS_LABELS, PRIORITY_LABELS } from '../../utils/format';

export default function TicketFilters({ filters, members, onChange, onReset }) {
  const set = (key) => (e) => onChange({ ...filters, [key]: e.target.value, page: 1 });
  return (
    <div className="filters">
      <label>
        Status
        <select value={filters.status} onChange={set('status')}>
          <option value="">All</option>
          {Object.entries(STATUS_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </label>
      <label>
        Priority
        <select value={filters.priority} onChange={set('priority')}>
          <option value="">All</option>
          {Object.entries(PRIORITY_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </label>
      <label>
        Assignee
        <select value={filters.assigneeId} onChange={set('assigneeId')}>
          <option value="">Anyone</option>
          <option value="unassigned">Unassigned</option>
          {members.filter((m) => m.role !== 'viewer').map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
      </label>
      <label>
        Overdue
        <select value={filters.overdue} onChange={set('overdue')}>
          <option value="">Any</option>
          <option value="true">Overdue only</option>
          <option value="false">Not overdue</option>
        </select>
      </label>
      <button type="button" className="btn btn-secondary btn-sm filters-reset" onClick={onReset}>Reset</button>
    </div>
  );
}
