import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import TicketFilters from './TicketFilters';
import TicketTable from './TicketTable';
import CommentList from './CommentList';
import CommentForm from './CommentForm';
import TicketEditForm from './TicketEditForm';
import { renderWithRouter, makeTicket } from '../../testUtils/renderWithRouter';

const members = [
  { id: 1, name: 'Alice', role: 'admin' },
  { id: 2, name: 'Agnes', role: 'agent' },
  { id: 3, name: 'Victor', role: 'viewer' },
];

describe('TicketFilters', () => {
  const filters = {
    status: '', priority: '', assigneeId: '', overdue: '', page: 3,
  };

  it('offers only staff as assignees plus Unassigned', () => {
    render(<TicketFilters filters={filters} members={members} onChange={jest.fn()} onReset={jest.fn()} />);
    const options = [...screen.getByLabelText('Assignee').options].map((o) => o.textContent);
    expect(options).toEqual(['Anyone', 'Unassigned', 'Alice', 'Agnes']);
  });

  it.each([
    ['Status', 'resolved', 'status'],
    ['Priority', 'urgent', 'priority'],
    ['Assignee', '2', 'assigneeId'],
    ['Overdue', 'true', 'overdue'],
  ])('changing %s resets to page 1', async (label, value, key) => {
    const onChange = jest.fn();
    render(<TicketFilters filters={filters} members={members} onChange={onChange} onReset={jest.fn()} />);
    await userEvent.selectOptions(screen.getByLabelText(label), value);
    expect(onChange).toHaveBeenCalledWith({ ...filters, [key]: value, page: 1 });
  });

  it('resets', async () => {
    const onReset = jest.fn();
    render(<TicketFilters filters={filters} members={[]} onChange={jest.fn()} onReset={onReset} />);
    await userEvent.click(screen.getByRole('button', { name: 'Reset' }));
    expect(onReset).toHaveBeenCalled();
  });
});

describe('TicketTable', () => {
  it('shows an empty state', () => {
    renderWithRouter(<TicketTable tickets={[]} />);
    expect(screen.getByText('No tickets match these filters.')).toBeInTheDocument();
  });

  it('renders the required columns and highlights overdue rows', () => {
    renderWithRouter(<TicketTable tickets={[
      makeTicket({ overdue: true }),
      makeTicket({ id: 101, title: 'Second', assignee: { id: 2, name: 'Agnes' } }),
    ]}
    />);
    expect(screen.getAllByRole('columnheader').map((h) => h.textContent))
      .toEqual(['ID', 'Title', 'Priority', 'Status', 'Assignee', 'Created', 'Updated', 'SLA']);
    const rows = screen.getAllByRole('row').slice(1);
    expect(rows[0]).toHaveClass('row-overdue');
    expect(rows[0]).toHaveTextContent('Unassigned');
    expect(rows[0]).toHaveTextContent('Overdue');
    expect(rows[1]).toHaveTextContent('Agnes');
  });

  it('navigates to details on click and Enter', async () => {
    renderWithRouter(<TicketTable tickets={[makeTicket()]} />);
    await userEvent.click(screen.getByText('VPN down'));
    expect(screen.getByTestId('location')).toHaveTextContent('/tickets/100');
  });

  it('supports keyboard navigation', async () => {
    renderWithRouter(<TicketTable tickets={[makeTicket({ id: 5 })]} />);
    const row = screen.getAllByRole('row')[1];
    row.focus();
    await userEvent.keyboard('{Tab}');
    row.focus();
    await userEvent.keyboard('{Enter}');
    expect(screen.getByTestId('location')).toHaveTextContent('/tickets/5');
  });
});

describe('CommentList', () => {
  it('renders an empty message', () => {
    render(<CommentList comments={[]} />);
    expect(screen.getByText('No comments yet.')).toBeInTheDocument();
  });

  it('renders author, role and message in order', () => {
    render(<CommentList comments={[
      { id: 1, message: 'first', createdAt: '2026-01-01T00:00:00Z', author: { id: 1, name: 'alice', role: 'admin' } },
      { id: 2, message: 'second', createdAt: '2026-01-01T00:01:00Z', author: { id: 2, name: 'Bob', role: 'agent' } },
    ]}
    />);
    const items = screen.getAllByRole('listitem');
    expect(items[0]).toHaveTextContent('alice');
    expect(items[0]).toHaveTextContent('first');
    expect(items[1]).toHaveTextContent('Agent');
    expect(screen.getByText('A')).toHaveClass('avatar');
  });
});

describe('CommentForm', () => {
  it('submits trimmed text and clears the box', async () => {
    // Arrange
    const onSubmit = jest.fn().mockResolvedValue();
    render(<CommentForm onSubmit={onSubmit} />);
    const box = screen.getByRole('textbox');
    // Act
    await userEvent.type(box, '  On it  ');
    await userEvent.click(screen.getByRole('button', { name: 'Add comment' }));
    // Assert
    expect(onSubmit).toHaveBeenCalledWith('On it');
    await waitFor(() => expect(box).toHaveValue(''));
  });

  it('keeps the text and shows the error when posting fails', async () => {
    const onSubmit = jest.fn().mockRejectedValue({ message: 'Closed tickets cannot receive comments' });
    render(<CommentForm onSubmit={onSubmit} />);
    await userEvent.type(screen.getByRole('textbox'), 'late');
    await userEvent.click(screen.getByRole('button', { name: 'Add comment' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Closed tickets cannot receive comments');
    expect(screen.getByRole('textbox')).toHaveValue('late');
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('ignores whitespace-only submissions', async () => {
    const onSubmit = jest.fn();
    const { container } = render(<CommentForm onSubmit={onSubmit} />);
    await userEvent.type(screen.getByRole('textbox'), '   ');
    expect(screen.getByRole('button', { name: 'Add comment' })).toBeDisabled();
    container.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    expect(onSubmit).not.toHaveBeenCalled();
  });
});

describe('TicketEditForm', () => {
  const staff = members.filter((m) => m.role !== 'viewer');

  it('only offers the current status and allowed transitions', () => {
    render(<TicketEditForm ticket={makeTicket({ status: 'resolved' })} staff={staff} onSave={jest.fn()} onCancel={jest.fn()} />);
    expect([...screen.getByLabelText('Status').options].map((o) => o.value)).toEqual(['resolved', 'open', 'closed']);
  });

  it('sends only changed fields plus the version', async () => {
    // Arrange
    const onSave = jest.fn().mockResolvedValue();
    render(<TicketEditForm ticket={makeTicket({ assignee: { id: 1, name: 'Alice' } })} staff={staff} onSave={onSave} onCancel={jest.fn()} />);
    // Act
    await userEvent.clear(screen.getByLabelText('Title'));
    await userEvent.type(screen.getByLabelText('Title'), 'New title');
    await userEvent.selectOptions(screen.getByLabelText('Status'), 'in_progress');
    await userEvent.selectOptions(screen.getByLabelText('Assignee'), '2');
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    // Assert
    expect(onSave).toHaveBeenCalledWith({
      title: 'New title', status: 'in_progress', assigneeId: 2, version: 3,
    });
  });

  it('sends assigneeId null when unassigning', async () => {
    const onSave = jest.fn().mockResolvedValue();
    render(<TicketEditForm ticket={makeTicket({ assignee: { id: 1, name: 'Alice' } })} staff={staff} onSave={onSave} onCancel={jest.fn()} />);
    await userEvent.selectOptions(screen.getByLabelText('Assignee'), '');
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(onSave).toHaveBeenCalledWith({ assigneeId: null, version: 3 });
  });

  it('cancels instead of saving when nothing changed', async () => {
    const onSave = jest.fn();
    const onCancel = jest.fn();
    render(<TicketEditForm ticket={makeTicket()} staff={staff} onSave={onSave} onCancel={onCancel} />);
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(onSave).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalled();
  });

  it('shows server errors (e.g. stale version)', async () => {
    const onSave = jest.fn().mockRejectedValue({ message: 'The ticket was modified by someone else.' });
    render(<TicketEditForm ticket={makeTicket()} staff={staff} onSave={onSave} onCancel={jest.fn()} />);
    await userEvent.selectOptions(screen.getByLabelText('Priority'), 'urgent');
    await userEvent.type(screen.getByLabelText('Description'), '!');
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('modified by someone else');
    expect(onSave).toHaveBeenCalledWith({ description: 'Users cannot connect!', priority: 'urgent', version: 3 });
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
  });

  it('resets the form when the ticket prop changes', () => {
    const { rerender } = render(<TicketEditForm ticket={makeTicket()} staff={staff} onSave={jest.fn()} onCancel={jest.fn()} />);
    rerender(<TicketEditForm ticket={makeTicket({ title: 'Updated elsewhere' })} staff={staff} onSave={jest.fn()} onCancel={jest.fn()} />);
    expect(screen.getByLabelText('Title')).toHaveValue('Updated elsewhere');
  });
});
