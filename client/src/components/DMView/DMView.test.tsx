import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import DMView from './DMView';
import { useTeamStore } from '../../stores/teamStore';
import { useAuthStore } from '../../stores/authStore';
import { useMessageStore } from '../../stores/messageStore';
import type { DMChannel } from '../../stores/dmStore';

// Mock dependencies
vi.mock('../../services/websocket', () => ({
  ws: {
    isConnected: vi.fn(() => false),
    on: vi.fn(() => vi.fn()),
    request: vi.fn(),
    sendDMMessage: vi.fn(),
    editDMMessage: vi.fn(),
    deleteDMMessage: vi.fn(),
    startDMTyping: vi.fn(),
  },
}));

vi.mock('../../services/api', () => ({
  api: {
    getDMMessages: vi.fn(() => Promise.resolve([])),
  },
}));

vi.mock('../../services/crypto', () => ({
  cryptoService: {
    encryptDM: vi.fn((_, __, plaintext: string) => Promise.resolve(plaintext)),
    decryptDM: vi.fn((_, __, content: string) => Promise.resolve(content)),
  },
}));

vi.mock('../../services/messageCache', () => ({
  cacheMessage: vi.fn(),
  getCachedMessage: vi.fn(() => Promise.resolve(null)),
  deleteCachedMessage: vi.fn(),
}));

vi.mock('../MessageList/MessageList', () => ({
  default: ({ channelId }: { channelId: string }) => (
    <div data-testid="message-list" data-channel-id={channelId} />
  ),
}));

vi.mock('../MessageInput/MessageInput', () => ({
  default: ({ channelName }: { channelName: string }) => (
    <div data-testid="message-input" data-channel-name={channelName} />
  ),
}));

const makeDM = (overrides?: Partial<DMChannel>): DMChannel => ({
  id: 'dm-1',
  team_id: 'team-1',
  is_group: false,
  members: [
    { user_id: 'user-1', username: 'alice', display_name: 'Alice' },
    { user_id: 'user-2', username: 'bob', display_name: 'Bob' },
  ],
  created_at: '2024-01-01T00:00:00Z',
  ...overrides,
});

describe('DMView', () => {
  beforeEach(() => {
    useTeamStore.setState({ activeTeamId: 'team-1' });
    useAuthStore.setState({ derivedKey: null } as never);
    useMessageStore.setState({
      messages: new Map(),
      typing: new Map(),
      loadingHistory: new Map(),
      hasMore: new Map(),
    });
  });

  it('renders MessageList and MessageInput', () => {
    render(<DMView dm={makeDM()} currentUserId="user-1" />);
    expect(screen.getByTestId('message-list')).toBeInTheDocument();
    expect(screen.getByTestId('message-input')).toBeInTheDocument();
  });

  it('passes DM id as channelId to MessageList', () => {
    render(<DMView dm={makeDM()} currentUserId="user-1" />);
    expect(screen.getByTestId('message-list')).toHaveAttribute('data-channel-id', 'dm-1');
  });

  it('shows the other participant name in MessageInput for 1:1 DM', () => {
    render(<DMView dm={makeDM()} currentUserId="user-1" />);
    expect(screen.getByTestId('message-input')).toHaveAttribute('data-channel-name', 'Bob');
  });

  it('shows comma-joined names for group DM', () => {
    const groupDM = makeDM({
      is_group: true,
      members: [
        { user_id: 'user-1', username: 'alice', display_name: 'Alice' },
        { user_id: 'user-2', username: 'bob', display_name: 'Bob' },
        { user_id: 'user-3', username: 'charlie', display_name: 'Charlie' },
      ],
    });
    render(<DMView dm={groupDM} currentUserId="user-1" />);
    expect(screen.getByTestId('message-input')).toHaveAttribute(
      'data-channel-name',
      'Alice, Bob, Charlie',
    );
  });

  it('shows member panel when showMembers is true for group DM', () => {
    const groupDM = makeDM({
      is_group: true,
      members: [
        { user_id: 'user-1', username: 'alice', display_name: 'Alice' },
        { user_id: 'user-2', username: 'bob', display_name: 'Bob' },
      ],
    });
    render(<DMView dm={groupDM} currentUserId="user-1" showMembers />);
    expect(screen.getByText('{{count}} members')).toBeInTheDocument();
    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.getByText('Bob')).toBeInTheDocument();
  });

  it('does not show member panel for non-group DM even with showMembers', () => {
    render(<DMView dm={makeDM()} currentUserId="user-1" showMembers />);
    expect(screen.queryByText('{{count}} members')).not.toBeInTheDocument();
  });
});
