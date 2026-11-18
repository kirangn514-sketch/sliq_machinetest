import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import ticketService from '../services/ticketService';
import useSocketEvents from '../hooks/useSocketEvents';
import useDebouncedCallback from '../hooks/useDebouncedCallback';
import Alert from '../components/common/Alert';
import Loading from '../components/common/Loading';
import TicketTable from '../components/tickets/TicketTable';
import { can } from '../utils/permissions';

const CARDS = [
  { key: 'total', label: 'Total tickets', link: '/tickets' },
  { key: 'open', label: 'Open', link: '/tickets?status=open' },
  { key: 'in_progress', label: 'In progress', link: '/tickets?status=in_progress' },
  { key: 'resolved', label: 'Resolved', link: '/tickets?status=resolved' },
  { key: 'closed', label: 'Closed', link: '/tickets?status=closed' },
  { key: 'overdue', label: 'Overdue', link: '/tickets?overdue=true', tone: 'danger' },
];

export default function Dashboard() {
  const { user } = useAuth();
  const [stats, setStats] = useState(null);
  const [recent, setRecent] = useState([]);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try {
      const [s, r] = await Promise.all([ticketService.stats(), ticketService.list({ page: 1, limit: 5 })]);
      setStats(s);
      setRecent(r.items);
      setError(null);
    } catch (err) {
      setError(err);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const refresh = useDebouncedCallback(load, 400);
  useSocketEvents({
    'ticket:created': refresh, 'ticket:updated': refresh, 'ticket:overdue': refresh,
  }, load);

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Dashboard</h1>
          <p className="muted">{user.organization.name} · live overview</p>
        </div>
        {can.createTicket(user) && <Link to="/tickets/new" className="btn btn-primary">+ New ticket</Link>}
      </div>
      <Alert error={error} />
      {!stats ? <Loading /> : (
        <div className="stat-grid">
          {CARDS.map((c) => (
            <Link key={c.key} to={c.link} className={`stat-card ${c.tone === 'danger' && stats[c.key] > 0 ? 'stat-danger' : ''}`}>
              <span className="stat-value">{stats[c.key]}</span>
              <span className="stat-label">{c.label}</span>
            </Link>
          ))}
        </div>
      )}
      <section className="card">
        <div className="card-header">
          <h2>Latest tickets</h2>
          <Link to="/tickets">View all →</Link>
        </div>
        <TicketTable tickets={recent} />
      </section>
    </div>
  );
}
