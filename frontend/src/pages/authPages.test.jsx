import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Login from './Login';
import Signup from './Signup';
import AcceptInvite from './AcceptInvite';
import { useAuth } from '../context/AuthContext';
import authService from '../services/authService';
import { renderWithRouter } from '../testUtils/renderWithRouter';

jest.mock('../context/AuthContext', () => ({ useAuth: jest.fn() }));
jest.mock('../services/authService', () => ({
  __esModule: true,
  default: { previewInvitation: jest.fn() },
}));

const auth = {
  login: jest.fn(), signup: jest.fn(), acceptInvitation: jest.fn(),
};
beforeEach(() => useAuth.mockReturnValue(auth));

describe('Login', () => {
  const fill = async () => {
    await userEvent.type(screen.getByLabelText('Email'), 'a@example.com');
    await userEvent.type(screen.getByLabelText('Password'), 'Password123');
  };

  it('logs in and goes to the dashboard', async () => {
    // Arrange
    auth.login.mockResolvedValue({});
    renderWithRouter(<Login />, { route: '/login', path: '/login' });
    // Act
    await fill();
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    // Assert
    expect(auth.login).toHaveBeenCalledWith({ email: 'a@example.com', password: 'Password123', organizationId: undefined });
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(/^\/$/));
  });

  it('shows an error for bad credentials', async () => {
    auth.login.mockRejectedValue({ message: 'Invalid email or password' });
    renderWithRouter(<Login />, { route: '/login', path: '/login' });
    await fill();
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid email or password');
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('asks which organization to use when the email belongs to several', async () => {
    // Arrange
    auth.login
      .mockRejectedValueOnce({ errorCode: 'ORGANIZATION_SELECTION_REQUIRED', details: { organizations: [{ id: 1, name: 'Acme' }, { id: 2, name: 'Globex' }] } })
      .mockResolvedValueOnce({});
    renderWithRouter(<Login />, { route: '/login', path: '/login' });
    await fill();
    // Act
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await userEvent.selectOptions(await screen.findByLabelText('Organization'), '2');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    // Assert
    expect(auth.login).toHaveBeenLastCalledWith({ email: 'a@example.com', password: 'Password123', organizationId: 2 });
  });
});

describe('Signup', () => {
  const fill = async (confirm = 'Password123') => {
    await userEvent.type(screen.getByLabelText('Organization name'), 'Acme');
    await userEvent.type(screen.getByLabelText('Your name'), 'Alice');
    await userEvent.type(screen.getByLabelText('Email'), 'alice@example.com');
    await userEvent.type(screen.getByLabelText(/^Password/), 'Password123');
    await userEvent.type(screen.getByLabelText('Confirm password'), confirm);
  };

  it('creates the organization without sending the confirmation field', async () => {
    auth.signup.mockResolvedValue({});
    renderWithRouter(<Signup />, { route: '/signup', path: '/signup' });
    await fill();
    await userEvent.click(screen.getByRole('button', { name: 'Create organization' }));
    expect(auth.signup).toHaveBeenCalledWith({
      organizationName: 'Acme', name: 'Alice', email: 'alice@example.com', password: 'Password123',
    });
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(/^\/$/));
  });

  it('blocks mismatched passwords client-side', async () => {
    renderWithRouter(<Signup />, { route: '/signup', path: '/signup' });
    await fill('Different1');
    await userEvent.click(screen.getByRole('button', { name: 'Create organization' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Passwords do not match');
    expect(auth.signup).not.toHaveBeenCalled();
  });

  it('shows server validation errors', async () => {
    auth.signup.mockRejectedValue({ message: 'Validation failed', fields: { email: 'email must be a valid email address' } });
    renderWithRouter(<Signup />, { route: '/signup', path: '/signup' });
    await fill();
    await userEvent.click(screen.getByRole('button', { name: 'Create organization' }));
    expect(await screen.findByText('email must be a valid email address')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
  });
});

describe('AcceptInvite', () => {
  const invite = {
    name: 'Bob', email: 'bob@example.com', role: 'agent', organizationName: 'Acme',
  };

  it('reads the token from the URL fragment, previews and accepts', async () => {
    // Arrange
    authService.previewInvitation.mockResolvedValue(invite);
    auth.acceptInvitation.mockResolvedValue({});
    const replaceState = jest.spyOn(window.history, 'replaceState');
    renderWithRouter(<AcceptInvite />, { route: '/accept-invite#token=tok123', path: '/accept-invite' });
    // Act
    expect(await screen.findByText(/you have been invited to/)).toHaveTextContent('Acme');
    await userEvent.type(screen.getByLabelText(/Choose a password/), 'Password123');
    await userEvent.type(screen.getByLabelText('Confirm password'), 'Password123');
    await userEvent.click(screen.getByRole('button', { name: 'Accept invitation' }));
    // Assert
    expect(authService.previewInvitation).toHaveBeenCalledWith('tok123');
    expect(auth.acceptInvitation).toHaveBeenCalledWith({ token: 'tok123', password: 'Password123' });
    expect(replaceState).toHaveBeenCalledWith(null, '', '/'); // token removed from history
  });

  it('rejects an incomplete link without calling the API', async () => {
    renderWithRouter(<AcceptInvite />, { route: '/accept-invite', path: '/accept-invite' });
    expect(await screen.findByRole('alert')).toHaveTextContent('incomplete');
    expect(authService.previewInvitation).not.toHaveBeenCalled();
    expect(screen.getByRole('link', { name: 'Go to sign in' })).toBeInTheDocument();
  });

  it('shows expired / used invitation errors', async () => {
    authService.previewInvitation.mockRejectedValue({ message: 'Invitation is invalid, already used or has expired' });
    renderWithRouter(<AcceptInvite />, { route: '/accept-invite#token=old', path: '/accept-invite' });
    expect(await screen.findByRole('alert')).toHaveTextContent('already used');
  });

  it('validates matching passwords and shows accept errors', async () => {
    authService.previewInvitation.mockResolvedValue(invite);
    auth.acceptInvitation.mockRejectedValue({ message: 'password must contain at least one letter and one number' });
    renderWithRouter(<AcceptInvite />, { route: '/accept-invite#token=tok', path: '/accept-invite' });
    await screen.findByText(/you have been invited to/);
    await userEvent.type(screen.getByLabelText(/Choose a password/), 'Password123');
    await userEvent.type(screen.getByLabelText('Confirm password'), 'nope');
    await userEvent.click(screen.getByRole('button', { name: 'Accept invitation' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Passwords do not match');
    await userEvent.clear(screen.getByLabelText('Confirm password'));
    await userEvent.type(screen.getByLabelText('Confirm password'), 'Password123');
    await userEvent.click(screen.getByRole('button', { name: 'Accept invitation' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('one letter and one number');
  });
});
