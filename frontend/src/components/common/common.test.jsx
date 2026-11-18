import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Alert from './Alert';
import Loading from './Loading';
import Pagination from './Pagination';
import {
  StatusBadge, PriorityBadge, RoleBadge, OverdueBadge, SlaBadge,
} from './Badges';

describe('Alert', () => {
  it('renders nothing without a message', () => {
    const { container } = render(<Alert error={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows an ApiError message with field errors as an alert', () => {
    render(<Alert error={{ message: 'Validation failed', fields: { a: 'title is required', b: 'email bad' } }} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Validation failed');
    expect(screen.getAllByRole('listitem').map((li) => li.textContent)).toEqual(['title is required', 'email bad']);
  });

  it('accepts plain strings and children, and other types as status', () => {
    const { rerender } = render(<Alert error="Passwords do not match" />);
    expect(screen.getByRole('alert')).toHaveTextContent('Passwords do not match');
    rerender(<Alert type="success">Saved</Alert>);
    expect(screen.getByRole('status')).toHaveTextContent('Saved');
  });

  it('can be dismissed', async () => {
    const onClose = jest.fn();
    render(<Alert error="x" onClose={onClose} />);
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(onClose).toHaveBeenCalled();
  });
});

describe('Loading', () => {
  it('announces a label', () => {
    render(<Loading />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading…');
  });
});

describe('Pagination', () => {
  it('renders nothing without metadata', () => {
    const { container } = render(<Pagination pagination={null} onPageChange={jest.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the range and navigates', async () => {
    // Arrange
    const onPageChange = jest.fn();
    render(<Pagination pagination={{ page: 2, totalPages: 3, total: 25, limit: 10 }} onPageChange={onPageChange} />);
    // Act
    await userEvent.click(screen.getByRole('button', { name: /Prev/ }));
    await userEvent.click(screen.getByRole('button', { name: /Next/ }));
    // Assert
    expect(screen.getByText('11–20 of 25')).toBeInTheDocument();
    expect(screen.getByText('Page 2 / 3')).toBeInTheDocument();
    expect(onPageChange.mock.calls).toEqual([[1], [3]]);
  });

  it('disables buttons at the edges and handles empty results', () => {
    render(<Pagination pagination={{ page: 1, totalPages: 1, total: 0, limit: 10 }} onPageChange={jest.fn()} />);
    expect(screen.getByRole('button', { name: /Prev/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Next/ })).toBeDisabled();
    expect(screen.getByText('0–0 of 0')).toBeInTheDocument();
  });
});

describe('Badges', () => {
  it('renders labels with modifier classes and falls back to raw values', () => {
    render(
      <>
        <StatusBadge status="in_progress" />
        <PriorityBadge priority="urgent" />
        <RoleBadge role="viewer" />
        <StatusBadge status="weird" />
        <PriorityBadge priority="odd" />
        <RoleBadge role="guest" />
      </>,
    );
    expect(screen.getByText('In progress')).toHaveClass('status-in_progress');
    expect(screen.getByText('Urgent')).toHaveClass('priority-urgent');
    expect(screen.getByText('Viewer')).toHaveClass('role-viewer');
    expect(screen.getByText('weird')).toBeInTheDocument();
    expect(screen.getByText('odd')).toBeInTheDocument();
    expect(screen.getByText('guest')).toBeInTheDocument();
  });

  it('shows the overdue badge only when overdue', () => {
    const { rerender } = render(<OverdueBadge overdue={false} />);
    expect(screen.queryByText(/Overdue/)).not.toBeInTheDocument();
    rerender(<OverdueBadge overdue />);
    expect(screen.getByText(/Overdue/)).toBeInTheDocument();
  });

  it.each([
    ['met', 'Responded within SLA'],
    ['breached', 'SLA breached'],
    ['stopped', 'SLA stopped'],
    ['not_applicable', 'Not monitored'],
    ['custom', 'custom'],
  ])('describes SLA state %s', (state, text) => {
    render(<SlaBadge sla={{ state, dueAt: null }} />);
    expect(screen.getByText(new RegExp(text))).toHaveClass(`sla-${state}`);
  });

  it('shows the countdown for on-track SLAs', () => {
    render(<SlaBadge sla={{ state: 'on_track', dueAt: new Date(Date.now() + 120000).toISOString() }} />);
    expect(screen.getByText(/Awaiting first staff response · due/)).toHaveAttribute('title', expect.stringMatching(/^Deadline:/));
  });

  it('renders nothing without SLA info', () => {
    const { container } = render(<SlaBadge sla={null} />);
    expect(container).toBeEmptyDOMElement();
  });
});
