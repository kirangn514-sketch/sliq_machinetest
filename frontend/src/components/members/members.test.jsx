import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import InviteMemberForm from './InviteMemberForm';
import MemberTable from './MemberTable';

describe('InviteMemberForm', () => {
  const fill = async () => {
    await userEvent.type(screen.getByLabelText('Name'), 'Bob');
    await userEvent.type(screen.getByLabelText('Email'), 'bob@example.com');
    await userEvent.selectOptions(screen.getByLabelText('Role'), 'viewer');
  };

  it('describes the selected role', async () => {
    render(<InviteMemberForm onInvite={jest.fn()} />);
    expect(screen.getByText(/update own or unassigned tickets/)).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText('Role'), 'viewer');
    expect(screen.getByText('Read-only access to tickets and comments')).toBeInTheDocument();
  });

  it('submits and shows the one-time link in development, with copy', async () => {
    // Arrange
    const onInvite = jest.fn().mockResolvedValue({
      invitation: { email: 'bob@example.com' }, invitationUrl: 'http://localhost:3000/accept-invite#token=abc',
    });
    const writeText = jest.fn().mockResolvedValue();
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    render(<InviteMemberForm onInvite={onInvite} />);
    // Act
    await fill();
    await userEvent.click(screen.getByRole('button', { name: 'Send invitation' }));
    // Assert
    expect(onInvite).toHaveBeenCalledWith({ name: 'Bob', email: 'bob@example.com', role: 'viewer' });
    expect(await screen.findByText('http://localhost:3000/accept-invite#token=abc')).toBeInTheDocument();
    expect(screen.getByLabelText('Name')).toHaveValue('');
    await userEvent.click(screen.getByRole('button', { name: 'Copy' }));
    expect(writeText).toHaveBeenCalledWith('http://localhost:3000/accept-invite#token=abc');
    expect(screen.getByRole('button', { name: 'Copied' })).toBeInTheDocument();
  });

  it('explains out-of-band delivery when no URL is returned (production)', async () => {
    render(<InviteMemberForm onInvite={jest.fn().mockResolvedValue({ invitation: { email: 'b@x.io' } })} />);
    await fill();
    await userEvent.click(screen.getByRole('button', { name: 'Send invitation' }));
    expect(await screen.findByText(/delivered out of band/)).toBeInTheDocument();
  });

  it('shows errors such as duplicate emails', async () => {
    render(<InviteMemberForm onInvite={jest.fn().mockRejectedValue({ message: 'A member with this email already exists' })} />);
    await fill();
    await userEvent.click(screen.getByRole('button', { name: 'Send invitation' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('already exists');
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

describe('MemberTable', () => {
  const members = [
    { id: 10, name: 'Alice', email: 'a@x.io', role: 'admin', createdAt: '2026-01-01T00:00:00Z' },
    { id: 20, name: 'Bob', email: 'b@x.io', role: 'agent', createdAt: '2026-01-01T00:00:00Z' },
  ];

  it('marks the current user and lets the admin change roles / remove', async () => {
    // Arrange
    const onChangeRole = jest.fn();
    const onRemove = jest.fn();
    render(<MemberTable members={members} currentUserId={10} busyId={null} onChangeRole={onChangeRole} onRemove={onRemove} />);
    const bobRow = screen.getByText('Bob').closest('tr');
    // Act
    await userEvent.selectOptions(within(bobRow).getByRole('combobox', { name: 'Change role of Bob' }), 'viewer');
    await userEvent.click(within(bobRow).getByRole('button', { name: 'Remove' }));
    // Assert
    expect(screen.getByText('(you)')).toBeInTheDocument();
    expect(onChangeRole).toHaveBeenCalledWith(members[1], 'viewer');
    expect(onRemove).toHaveBeenCalledWith(members[1]);
  });

  it('disables controls for the row being updated', () => {
    render(<MemberTable members={members} currentUserId={10} busyId={20} onChangeRole={jest.fn()} onRemove={jest.fn()} />);
    const bobRow = screen.getByText('Bob').closest('tr');
    expect(within(bobRow).getByRole('button', { name: 'Remove' })).toBeDisabled();
    expect(within(bobRow).getByRole('combobox')).toBeDisabled();
  });
});
