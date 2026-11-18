import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import ticketService from '../services/ticketService';
import commentService from '../services/commentService';
import memberService from '../services/memberService';
import useSocketEvents from '../hooks/useSocketEvents';
import useDebouncedCallback from '../hooks/useDebouncedCallback';
import Alert from '../components/common/Alert';
import Loading from '../components/common/Loading';
import {
  StatusBadge, PriorityBadge, OverdueBadge, SlaBadge,
} from '../components/common/Badges';
import CommentList from '../components/tickets/CommentList';
import CommentForm from '../components/tickets/CommentForm';
import TicketEditForm from '../components/tickets/TicketEditForm';
import { can } from '../utils/permissions';
import { formatDate } from '../utils/format';

function mergeComments(existing, incoming) {
  if (existing.some((c) => c.id === incoming.id)) return existing;
  return [...existing, incoming].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt) || a.id - b.id);
}

export default function TicketDetails() {
  const { id } = useParams();
  const ticketId = Number(id);
  const { user } = useAuth();
  const [ticket, setTicket] = useState(null);
  const [comments, setComments] = useState([]);
  const [staff, setStaff] = useState([]);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  const load = useCallback(async () => {
    try {
      const t = await ticketService.get(ticketId);
      const { comments: c, ...rest } = t;
      setTicket(rest);
      setComments(c);
      setError(null);
    } catch (err) {
      setError(err);
      setTicket(null);
    }
  }, [ticketId]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    memberService.directory().then((m) => setStaff(m.filter((x) => x.role !== 'viewer'))).catch(() => {});
  }, []);

  const refresh = useDebouncedCallback(load, 300);
  useSocketEvents({
    'ticket:updated': (t) => { if (t && t.id === ticketId) refresh(); },
    'ticket:overdue': (t) => { if (t && t.id === ticketId) refresh(); },
    'comment:created': (p) => { if (p && p.ticketId === ticketId) setComments((prev) => mergeComments(prev, p.comment)); },
  }, load);

  const handleSave = async (changes) => {
    try {
      const updated = await ticketService.update(ticketId, changes);
      setTicket(updated);
      setEditing(false);
      setNotice('Ticket updated');
    } catch (err) {
      if (err.errorCode === 'STALE_TICKET') await load();
      throw err;
    }
  };

  const handleComment = async (message) => {
    const comment = await commentService.create(ticketId, message);
    setComments((prev) => mergeComments(prev, comment));
  };

  if (error && !ticket) {
    return (
      <div className="page">
        <Alert error={error} />
        <Link to="/tickets">← Back to tickets</Link>
      </div>
    );
  }
  if (!ticket) return <Loading />;

  const canEdit = can.updateTicket(user, ticket);

  return (
    <div className="page">
      <Link to="/tickets" className="back-link">← Back to tickets</Link>
      <div className="page-header">
        <div>
          <h1>
            <span className="muted mono">#{ticket.id}</span> {ticket.title}
          </h1>
          <div className="badge-row">
            <StatusBadge status={ticket.status} />
            <PriorityBadge priority={ticket.priority} />
            <OverdueBadge overdue={ticket.overdue} />
          </div>
        </div>
        {canEdit && !editing && (
          <button type="button" className="btn btn-primary" onClick={() => setEditing(true)}>Edit ticket</button>
        )}
      </div>
      {notice && <Alert type="success" onClose={() => setNotice(null)}>{notice}</Alert>}
      {ticket.status === 'closed' && <Alert type="info">This ticket is closed and can no longer be modified.</Alert>}

      <div className="details-grid">
        <div className="details-main">
          {editing ? (
            <TicketEditForm ticket={ticket} staff={staff} onSave={handleSave} onCancel={() => setEditing(false)} />
          ) : (
            <section className="card">
              <h2>Description</h2>
              <p className="description">{ticket.description}</p>
            </section>
          )}
          <section className="card">
            <h2>Comments ({comments.length})</h2>
            <CommentList comments={comments} />
            {can.comment(user, ticket) && <CommentForm onSubmit={handleComment} />}
          </section>
        </div>

        <aside className="card details-side">
          <dl>
            <dt>Assignee</dt>
            <dd>{ticket.assignee ? ticket.assignee.name : <span className="muted">Unassigned</span>}</dd>
            <dt>Created by</dt>
            <dd>{ticket.creator.name}</dd>
            <dt>Created</dt>
            <dd>{formatDate(ticket.createdAt)}</dd>
            <dt>Last updated</dt>
            <dd>{formatDate(ticket.updatedAt)}</dd>
            <dt>SLA</dt>
            <dd><SlaBadge sla={ticket.sla} /></dd>
            {ticket.sla.dueAt && (
              <>
                <dt>SLA deadline</dt>
                <dd>{formatDate(ticket.sla.dueAt)}</dd>
              </>
            )}
          </dl>
          {!canEdit && ticket.status !== 'closed' && user.role !== 'viewer' && (
            <p className="muted small">Only the assignee or an admin can edit this ticket.</p>
          )}
        </aside>
      </div>
    </div>
  );
}
