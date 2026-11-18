import { useNavigate } from 'react-router-dom';
import { StatusBadge, PriorityBadge, OverdueBadge } from '../common/Badges';
import { formatDate } from '../../utils/format';

export default function TicketTable({ tickets }) {
  const navigate = useNavigate();
  if (tickets.length === 0) {
    return <div className="empty-state"><p>No tickets match these filters.</p></div>;
  }
  return (
    <div className="table-wrap">
      <table className="table table-clickable">
        <thead>
          <tr>
            <th>ID</th>
            <th>Title</th>
            <th>Priority</th>
            <th>Status</th>
            <th>Assignee</th>
            <th>Created</th>
            <th>Updated</th>
            <th>SLA</th>
          </tr>
        </thead>
        <tbody>
          {tickets.map((t) => (
            <tr
              key={t.id}
              onClick={() => navigate(`/tickets/${t.id}`)}
              onKeyDown={(e) => { if (e.key === 'Enter') navigate(`/tickets/${t.id}`); }}
              tabIndex={0}
              className={t.overdue ? 'row-overdue' : ''}
            >
              <td className="mono">#{t.id}</td>
              <td className="cell-title">{t.title}</td>
              <td><PriorityBadge priority={t.priority} /></td>
              <td><StatusBadge status={t.status} /></td>
              <td>{t.assignee ? t.assignee.name : <span className="muted">Unassigned</span>}</td>
              <td className="nowrap">{formatDate(t.createdAt)}</td>
              <td className="nowrap">{formatDate(t.updatedAt)}</td>
              <td>{t.overdue ? <OverdueBadge overdue /> : <span className="muted">—</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
