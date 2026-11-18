import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import memberService from '../services/memberService';
import useSocketEvents from '../hooks/useSocketEvents';
import Alert from '../components/common/Alert';
import Loading from '../components/common/Loading';
import { RoleBadge } from '../components/common/Badges';
import MemberTable from '../components/members/MemberTable';
import InviteMemberForm from '../components/members/InviteMemberForm';
import { ROLE_DESCRIPTIONS, formatDate } from '../utils/format';

export default function Members() {
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(async () => {
    try {
      setData(await memberService.list());
    } catch (err) {
      setError(err);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  useSocketEvents({ 'members:changed': load }, load);

  const run = async (id, action, successMessage) => {
    setBusyId(id);
    setError(null);
    setNotice(null);
    try {
      await action();
      setNotice(successMessage);
      await load();
    } catch (err) {
      setError(err);
      await load();
    } finally {
      setBusyId(null);
    }
  };

  const changeRole = (member, role) => run(
    member.id,
    () => memberService.changeRole(member.id, role),
    `${member.name} is now ${role}.`,
  );

  const remove = (member) => {
    const self = member.id === user.id ? ' You will be signed out.' : '';
    if (!window.confirm(`Remove ${member.name}? Their tickets will become unassigned.${self}`)) return;
    run(member.id, () => memberService.remove(member.id), `${member.name} was removed.`);
  };

  const revoke = (inv) => run(`inv-${inv.id}`, () => memberService.revokeInvitation(inv.id), 'Invitation revoked.');

  const invite = async (payload) => {
    const result = await memberService.invite(payload);
    await load();
    return result;
  };

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Members</h1>
          <p className="muted">Manage who can access {user.organization.name}.</p>
        </div>
      </div>
      <Alert error={error} onClose={() => setError(null)} />
      {notice && <Alert type="success" onClose={() => setNotice(null)}>{notice}</Alert>}

      <InviteMemberForm onInvite={invite} />

      <section className="card">
        <h2>Active members</h2>
        {!data ? <Loading /> : (
          <MemberTable
            members={data.members}
            currentUserId={user.id}
            busyId={busyId}
            onChangeRole={changeRole}
            onRemove={remove}
          />
        )}
      </section>

      {data && data.invitations.length > 0 && (
        <section className="card">
          <h2>Pending invitations</h2>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr><th>Name</th><th>Email</th><th>Role</th><th>Expires</th><th aria-label="Actions" /></tr>
              </thead>
              <tbody>
                {data.invitations.map((inv) => (
                  <tr key={inv.id}>
                    <td>{inv.name}</td>
                    <td>{inv.email}</td>
                    <td><RoleBadge role={inv.role} /></td>
                    <td className="nowrap">{formatDate(inv.expiresAt)}</td>
                    <td className="actions">
                      <button type="button" className="btn btn-secondary btn-sm" disabled={busyId === `inv-${inv.id}`} onClick={() => revoke(inv)}>
                        Revoke
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className="card">
        <h2>Roles</h2>
        <ul className="role-help">
          {Object.entries(ROLE_DESCRIPTIONS).map(([role, text]) => (
            <li key={role}><RoleBadge role={role} /> {text}</li>
          ))}
        </ul>
      </section>
    </div>
  );
}
