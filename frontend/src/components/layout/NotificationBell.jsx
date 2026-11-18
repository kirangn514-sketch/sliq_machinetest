import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import notificationService from '../../services/notificationService';
import useSocketEvents from '../../hooks/useSocketEvents';
import { relativeTime } from '../../utils/format';

export default function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [unread, setUnread] = useState(0);
  const [toast, setToast] = useState(null);
  const ref = useRef(null);

  const load = useCallback(async () => {
    try {
      const data = await notificationService.list({ page: 1, limit: 15 });
      setItems(data.items);
      setUnread(data.unreadCount);
    } catch {
      /* the bell is non-critical; errors surface elsewhere */
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const close = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(t);
  }, [toast]);

  useSocketEvents({
    'notification:created': (n) => {
      setItems((prev) => [{ ...n, unread: true }, ...prev.filter((p) => p.id !== n.id)].slice(0, 15));
      setUnread((u) => u + 1);
      setToast(n);
    },
  }, load);

  const markRead = async (n) => {
    if (!n.unread) return;
    await notificationService.markRead(n.id);
    setItems((prev) => prev.map((p) => (p.id === n.id ? { ...p, unread: false } : p)));
    setUnread((u) => Math.max(0, u - 1));
  };

  const markAll = async () => {
    await notificationService.markAllRead();
    setItems((prev) => prev.map((p) => ({ ...p, unread: false })));
    setUnread(0);
  };

  return (
    <div className="bell" ref={ref}>
      <button type="button" className="bell-button" onClick={() => setOpen((o) => !o)} aria-label={`Notifications (${unread} unread)`}>
        <span aria-hidden="true">🔔</span>
        {unread > 0 && <span className="bell-count">{unread > 99 ? '99+' : unread}</span>}
      </button>
      {open && (
        <div className="bell-panel">
          <div className="bell-header">
            <strong>Notifications</strong>
            {unread > 0 && <button type="button" className="link-button" onClick={markAll}>Mark all read</button>}
          </div>
          {items.length === 0 && <p className="muted bell-empty">No notifications yet.</p>}
          <ul className="bell-list">
            {items.map((n) => (
              <li key={n.id} className={n.unread ? 'unread' : ''}>
                <Link to={`/tickets/${n.ticketId}`} onClick={() => { markRead(n); setOpen(false); }}>
                  <span className={`bell-type type-${n.type}`}>{n.type === 'sla_overdue' ? 'SLA' : 'Assigned'}</span>
                  <span className="bell-message">{n.message}</span>
                  <span className="muted bell-time">{relativeTime(n.createdAt)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
      {toast && (
        <div className="toast" role="status">
          <strong>{toast.type === 'sla_overdue' ? 'SLA breached' : 'Notification'}</strong>
          <span>{toast.message}</span>
        </div>
      )}
    </div>
  );
}
