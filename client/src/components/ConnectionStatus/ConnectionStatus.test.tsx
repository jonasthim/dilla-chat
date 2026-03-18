import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ConnectionStatus from './ConnectionStatus';
import { useTeamStore } from '../../stores/teamStore';

vi.mock('../../services/websocket', () => ({
  ws: {
    isConnected: vi.fn(() => false),
    on: vi.fn(() => vi.fn()),
    ping: vi.fn(() => Promise.resolve(50)),
  },
}));

describe('ConnectionStatus', () => {
  beforeEach(() => {
    useTeamStore.setState({ activeTeamId: 'team-1' });
  });

  it('renders the connection status bars', () => {
    const { container } = render(<ConnectionStatus />);
    expect(container.querySelector('.connection-status')).toBeInTheDocument();
    expect(container.querySelector('.connection-status__bars')).toBeInTheDocument();
  });

  it('renders 4 bar elements', () => {
    const { container } = render(<ConnectionStatus />);
    const bars = container.querySelectorAll('.connection-status__bar');
    expect(bars).toHaveLength(4);
  });

  it('shows disconnected state initially when ws is not connected', () => {
    const { container } = render(<ConnectionStatus />);
    expect(container.querySelector('.connection-status--disconnected')).toBeInTheDocument();
  });

  it('shows no active bars when disconnected', () => {
    const { container } = render(<ConnectionStatus />);
    const activeBars = container.querySelectorAll('.connection-status__bar.active');
    expect(activeBars).toHaveLength(0);
  });

  it('shows tooltip on mouse enter', () => {
    const { container } = render(<ConnectionStatus />);
    const statusEl = container.querySelector('.connection-status')!;
    fireEvent.mouseEnter(statusEl);
    expect(screen.getByText('Connection Info')).toBeInTheDocument();
    expect(screen.getByText('Quality')).toBeInTheDocument();
    expect(screen.getByText('Latency')).toBeInTheDocument();
    expect(screen.getByText('WebSocket')).toBeInTheDocument();
  });

  it('hides tooltip on mouse leave', () => {
    const { container } = render(<ConnectionStatus />);
    const statusEl = container.querySelector('.connection-status')!;
    fireEvent.mouseEnter(statusEl);
    expect(screen.getByText('Connection Info')).toBeInTheDocument();
    fireEvent.mouseLeave(statusEl);
    expect(screen.queryByText('Connection Info')).not.toBeInTheDocument();
  });

  it('shows Disconnected in tooltip when disconnected', () => {
    const { container } = render(<ConnectionStatus />);
    const statusEl = container.querySelector('.connection-status')!;
    fireEvent.mouseEnter(statusEl);
    // Both quality badge and WebSocket row show 'Disconnected'
    const elements = screen.getAllByText('Disconnected');
    expect(elements.length).toBeGreaterThanOrEqual(1);
  });

  it('shows dash for latency when no latency data', () => {
    const { container } = render(<ConnectionStatus />);
    const statusEl = container.querySelector('.connection-status')!;
    fireEvent.mouseEnter(statusEl);
    // The em-dash character for null latency
    const rows = container.querySelectorAll('.connection-status__tooltip-row');
    // Latency row is the second row
    const latencyRow = rows[1];
    expect(latencyRow.textContent).toContain('\u2014');
  });
});
