import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { can } from '../../utils/permissions';
import { RoleBadge } from '../common/Badges';
import NotificationBell from './NotificationBell';

export default function Navbar() {
  const { user, logout, connected } = useAuth();
  const navigate = useNavigate();

  const handleLogout = async () => {
    await logout();
    navigate('/login', { replace: true });
  };

  return (
    <header className="navbar">
      <div className="navbar-left">
        <NavLink to="/" className="brand">
          <span className="brand-mark">S</span>
          SliqDesk
        </NavLink>
        <nav className="nav-links">
          <NavLink to="/" end>Dashboard</NavLink>
          <NavLink to="/tickets" end>Tickets</NavLink>
          {can.createTicket(user) && <NavLink to="/tickets/new">New ticket</NavLink>}
          {can.manageMembers(user) && <NavLink to="/members">Members</NavLink>}
          {can.manageSettings(user) && <NavLink to="/settings">Settings</NavLink>}
        </nav>
      </div>
      <div className="navbar-right">
        <span
          className={`live-dot ${connected ? 'on' : 'off'}`}
          title={connected ? 'Live updates connected' : 'Live updates disconnected - reconnecting'}
        />
        <NotificationBell />
        <div className="user-chip">
          <div className="user-chip-text">
            <strong>{user.name}</strong>
            <span className="muted">{user.organization.name}</span>
          </div>
          <RoleBadge role={user.role} />
        </div>
        <button type="button" className="btn btn-secondary btn-sm" onClick={handleLogout}>Log out</button>
      </div>
    </header>
  );
}
