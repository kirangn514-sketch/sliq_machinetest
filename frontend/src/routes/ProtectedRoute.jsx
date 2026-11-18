import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import Loading from '../components/common/Loading';

/**
 * Guards client routes. `roles` restricts by role (UI only - the API enforces the same).
 * Renders child routes through <Outlet />.
 */
export default function ProtectedRoute({ roles }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) return <Loading label="Checking your session…" />;
  if (!user) return <Navigate to="/login" replace state={{ from: location }} />;
  if (roles && !roles.includes(user.role)) {
    return (
      <div className="page">
        <div className="card empty-state">
          <h2>Access denied</h2>
          <p>Your role ({user.role}) does not have access to this page.</p>
        </div>
      </div>
    );
  }
  return <Outlet />;
}

/** For login/signup pages: bounce authenticated users to the dashboard. */
export function GuestRoute() {
  const { user, loading } = useAuth();
  if (loading) return <Loading label="Loading…" />;
  if (user) return <Navigate to="/" replace />;
  return <Outlet />;
}
