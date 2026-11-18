import { RoleBadge } from '../common/Badges';
import { ROLE_LABELS, formatDate } from '../../utils/format';

export default function MemberTable({
  members, currentUserId, busyId, onChangeRole, onRemove,
}) {
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Email</th>
            <th>Role</th>
            <th>Joined</th>
            <th aria-label="Actions" />
          </tr>
        </thead>
        <tbody>
          {members.map((m) => (
            <tr key={m.id}>
              <td>
                {m.name}
                {m.id === currentUserId && <span className="muted"> (you)</span>}
              </td>
              <td>{m.email}</td>
              <td>
                <div className="role-cell">
                  <RoleBadge role={m.role} />
                  <select
                    value={m.role}
                    disabled={busyId === m.id}
                    onChange={(e) => onChangeRole(m, e.target.value)}
                    aria-label={`Change role of ${m.name}`}
                  >
                    {Object.entries(ROLE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </div>
              </td>
              <td className="nowrap">{formatDate(m.createdAt)}</td>
              <td className="actions">
                <button type="button" className="btn btn-danger btn-sm" disabled={busyId === m.id} onClick={() => onRemove(m)}>
                  Remove
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
