import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import VoiceChannel from './VoiceChannel';
import { useVoiceStore } from '../../stores/voiceStore';
import { useTeamStore, type Channel } from '../../stores/teamStore';

// Override i18n mock to handle options objects (e.g. t('key', { count: 1 }))
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, defaultOrOpts?: string | Record<string, unknown>) => {
      if (typeof defaultOrOpts === 'string') return defaultOrOpts;
      return key;
    },
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}));

vi.mock('iconoir-react', () => ({
  SoundHigh: () => <span data-testid="icon-sound" />,
  MicrophoneMute: () => <span data-testid="icon-mic-mute" />,
  HeadsetWarning: () => <span data-testid="icon-deafen" />,
  AppWindow: () => <span data-testid="icon-screen" />,
  Collapse: () => <span data-testid="icon-collapse" />,
  VideoCamera: () => <span data-testid="icon-camera" />,
}));

const channel: Channel = {
  id: 'voice-ch-1',
  teamId: 'team-1',
  name: 'Voice Lounge',
  topic: '',
  type: 'voice',
  position: 0,
  category: '',
};

function setVoiceState(overrides: Record<string, unknown>) {
  useVoiceStore.setState({
    currentChannelId: null,
    currentTeamId: null,
    connected: false,
    connecting: false,
    muted: false,
    deafened: false,
    speaking: false,
    screenSharing: false,
    screenSharingUserId: null,
    remoteScreenStream: null,
    localScreenStream: null,
    webcamSharing: false,
    localWebcamStream: null,
    remoteWebcamStreams: {},
    peers: {},
    voiceOccupants: {},
    joinChannel: vi.fn(),
    leaveChannel: vi.fn(),
    ...overrides,
  } as never);
}

describe('VoiceChannel', () => {
  beforeEach(() => {
    useTeamStore.setState({ activeTeamId: 'team-1' });
    setVoiceState({});
  });

  it('renders empty state when not connected', () => {
    render(<VoiceChannel channel={channel} />);
    // t('voice.join') returns the key since no default value
    expect(screen.getByText('voice.join')).toBeInTheDocument();
  });

  it('shows join button when not in channel', () => {
    render(<VoiceChannel channel={channel} />);
    const btn = screen.getByRole('button', { name: /voice\.join/i });
    expect(btn).toBeInTheDocument();
    expect(btn).not.toBeDisabled();
  });

  it('shows connecting state on button when connecting', () => {
    setVoiceState({ connecting: true });
    render(<VoiceChannel channel={channel} />);
    const btn = screen.getByRole('button', { name: /voice\.connecting/i });
    expect(btn).toBeDisabled();
  });

  it('shows leave button when connected to this channel', () => {
    setVoiceState({
      connected: true,
      currentChannelId: 'voice-ch-1',
      peers: {
        'user-1': {
          user_id: 'user-1',
          username: 'alice',
          muted: false,
          deafened: false,
          speaking: false,
          voiceLevel: 0,
        },
      },
    });
    render(<VoiceChannel channel={channel} />);
    expect(screen.getByText('voice.leave')).toBeInTheDocument();
  });

  it('renders participant names when connected', () => {
    setVoiceState({
      connected: true,
      currentChannelId: 'voice-ch-1',
      peers: {
        'user-1': {
          user_id: 'user-1',
          username: 'alice',
          muted: false,
          deafened: false,
          speaking: false,
          voiceLevel: 0,
        },
        'user-2': {
          user_id: 'user-2',
          username: 'bob',
          muted: false,
          deafened: false,
          speaking: false,
          voiceLevel: 0,
        },
      },
    });
    render(<VoiceChannel channel={channel} />);
    expect(screen.getByText('alice')).toBeInTheDocument();
    expect(screen.getByText('bob')).toBeInTheDocument();
  });

  it('shows muted indicator for muted peers', () => {
    setVoiceState({
      connected: true,
      currentChannelId: 'voice-ch-1',
      peers: {
        'user-1': {
          user_id: 'user-1',
          username: 'alice',
          muted: true,
          deafened: false,
          speaking: false,
          voiceLevel: 0,
        },
      },
    });
    render(<VoiceChannel channel={channel} />);
    expect(screen.getByTestId('icon-mic-mute')).toBeInTheDocument();
  });

  it('shows deafened indicator for deafened peers', () => {
    setVoiceState({
      connected: true,
      currentChannelId: 'voice-ch-1',
      peers: {
        'user-1': {
          user_id: 'user-1',
          username: 'alice',
          muted: false,
          deafened: true,
          speaking: false,
          voiceLevel: 0,
        },
      },
    });
    render(<VoiceChannel channel={channel} />);
    expect(screen.getByTestId('icon-deafen')).toBeInTheDocument();
  });

  it('shows speaking class for speaking peers', () => {
    setVoiceState({
      connected: true,
      currentChannelId: 'voice-ch-1',
      peers: {
        'user-1': {
          user_id: 'user-1',
          username: 'alice',
          muted: false,
          deafened: false,
          speaking: true,
          voiceLevel: 0.5,
        },
      },
    });
    const { container } = render(<VoiceChannel channel={channel} />);
    expect(container.querySelector('.voice-tile.speaking')).toBeInTheDocument();
  });

  it('calls joinChannel when join button is clicked', () => {
    const joinChannel = vi.fn();
    setVoiceState({ joinChannel });
    render(<VoiceChannel channel={channel} />);
    fireEvent.click(screen.getByText('voice.join'));
    expect(joinChannel).toHaveBeenCalledWith('team-1', 'voice-ch-1');
  });

  it('calls leaveChannel when leave button is clicked', () => {
    const leaveChannel = vi.fn();
    setVoiceState({
      connected: true,
      currentChannelId: 'voice-ch-1',
      leaveChannel,
      peers: {
        'user-1': {
          user_id: 'user-1',
          username: 'alice',
          muted: false,
          deafened: false,
          speaking: false,
          voiceLevel: 0,
        },
      },
    });
    render(<VoiceChannel channel={channel} />);
    fireEvent.click(screen.getByText('voice.leave'));
    expect(leaveChannel).toHaveBeenCalled();
  });
});
