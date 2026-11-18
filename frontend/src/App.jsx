import { Navigate, Route, Routes } from 'react-router-dom';
import ProtectedRoute, { GuestRoute } from './routes/ProtectedRoute';
import Layout from './components/layout/Layout';
import Login from './pages/Login';
import Signup from './pages/Signup';
import AcceptInvite from './pages/AcceptInvite';
import Dashboard from './pages/Dashboard';
import TicketList from './pages/TicketList';
import TicketDetails from './pages/TicketDetails';
import CreateTicket from './pages/CreateTicket';
import Members from './pages/Members';
import Settings from './pages/Settings';

export default function App() {
  return (
    <Routes>
      <Route element={<GuestRoute />}>
        <Route path="/login" element={<Login />} />
        <Route path="/signup" element={<Signup />} />
      </Route>
      <Route path="/accept-invite" element={<AcceptInvite />} />

      <Route element={<ProtectedRoute />}>
        <Route element={<Layout />}>
          <Route index element={<Dashboard />} />
          <Route path="/tickets" element={<TicketList />} />
          <Route path="/tickets/:id" element={<TicketDetails />} />
          <Route element={<ProtectedRoute roles={['admin', 'agent']} />}>
            <Route path="/tickets/new" element={<CreateTicket />} />
          </Route>
          <Route element={<ProtectedRoute roles={['admin']} />}>
            <Route path="/members" element={<Members />} />
            <Route path="/settings" element={<Settings />} />
          </Route>
        </Route>
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
