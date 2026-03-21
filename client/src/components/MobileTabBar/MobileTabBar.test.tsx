import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import MobileTabBar from './MobileTabBar';

describe('MobileTabBar', () => {
  it('renders 4 tabs', () => {
    render(<MobileTabBar activeTab="chat" onTabChange={vi.fn()} />);
    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(4);
  });

  it('highlights the active tab', () => {
    render(<MobileTabBar activeTab="channels" onTabChange={vi.fn()} />);
    const channelsTab = screen.getByText('Kanals').closest('button')!;
    expect(channelsTab).toHaveClass('active');
    expect(channelsTab).toHaveAttribute('aria-current', 'page');
  });

  it('calls onTabChange when a tab is clicked', async () => {
    const onTabChange = vi.fn();
    render(<MobileTabBar activeTab="chat" onTabChange={onTabChange} />);
    const teamsTab = screen.getByText('Teams').closest('button')!;
    await userEvent.click(teamsTab);
    expect(onTabChange).toHaveBeenCalledWith('teams');
  });

  it('renders correct labels', () => {
    render(<MobileTabBar activeTab="chat" onTabChange={vi.fn()} />);
    expect(screen.getByText('Teams')).toBeInTheDocument();
    expect(screen.getByText('Kanals')).toBeInTheDocument();
    expect(screen.getByText('Chat')).toBeInTheDocument();
    expect(screen.getByText('Members')).toBeInTheDocument();
  });
});
