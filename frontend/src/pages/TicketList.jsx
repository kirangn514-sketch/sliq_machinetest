import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import ticketService from '../services/ticketService';
import memberService from '../services/memberService';
import useSocketEvents from '../hooks/useSocketEvents';
import useDebouncedCallback from '../hooks/useDebouncedCallback';
import Alert from '../components/common/Alert';
import Loading from '../components/common/Loading';
import Pagination from '../components/common/Pagination';
import TicketFilters from '../components/tickets/TicketFilters';
import TicketTable from '../components/tickets/TicketTable';
import { can } from '../utils/permissions';

const FILTER_KEYS = ['status', 'priority', 'assigneeId', 'overdue'];

/** Filters live in the URL so they survive refresh and can be shared/bookmarked. */
export default function TicketList() {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [data, setData] = useState(null);
  const [members, setMembers] = useState([]);
  const [error, setError] = useState(null);

  const filters = useMemo(() => ({
    ...Object.fromEntries(FILTER_KEYS.map((k) => [k, searchParams.get(k) || ''])),
    page: Number(searchParams.get('page')) || 1,
    limit: 10,
  }), [searchParams]);

  const load = useCallback(async () => {
    try {
      setData(await ticketService.list(filters));
      setError(null);
    } catch (err) {
      setError(err);
    }
  }, [filters]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { memberService.directory().then(setMembers).catch(() => {}); }, []);

  const refresh = useDebouncedCallback(load, 400);
  useSocketEvents({
    'ticket:created': refresh, 'ticket:updated': refresh, 'ticket:overdue': refresh,
  }, load);

  const updateFilters = (next) => {
    const params = {};
    FILTER_KEYS.forEach((k) => { if (next[k]) params[k] = next[k]; });
    if (next.page > 1) params.page = String(next.page);
    setSearchParams(params);
  };

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Tickets</h1>
          <p className="muted">Updates appear live — no refresh needed.</p>
        </div>
        {can.createTicket(user) && <Link to="/tickets/new" className="btn btn-primary">+ New ticket</Link>}
      </div>
      <section className="card">
        <TicketFilters
          filters={filters}
          members={members}
          onChange={updateFilters}
          onReset={() => setSearchParams({})}
        />
        <Alert error={error} />
        {!data ? <Loading /> : (
          <>
            <TicketTable tickets={data.items} />
            <Pagination pagination={data.pagination} onPageChange={(page) => updateFilters({ ...filters, page })} />
          </>
        )}
      </section>
    </div>
  );
}
