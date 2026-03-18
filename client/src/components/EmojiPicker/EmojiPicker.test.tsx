import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import EmojiPicker from './EmojiPicker';

// Mock the emoji-picker-react library
vi.mock('emoji-picker-react', () => {
  const React = require('react');
  const MockPicker = ({ onEmojiClick }: { onEmojiClick: (data: { emoji: string }) => void }) => (
    <div data-testid="emoji-picker-inner">
      <button data-testid="emoji-smile" onClick={() => onEmojiClick({ emoji: '😊' })}>
        😊
      </button>
      <button data-testid="emoji-heart" onClick={() => onEmojiClick({ emoji: '❤️' })}>
        ❤️
      </button>
    </div>
  );
  return {
    default: MockPicker,
    Theme: { DARK: 'dark' },
  };
});

describe('EmojiPicker', () => {
  const onSelect = vi.fn();
  const onClose = vi.fn();

  beforeEach(() => {
    onSelect.mockClear();
    onClose.mockClear();
  });

  it('renders the picker', () => {
    render(<EmojiPicker onSelect={onSelect} onClose={onClose} />);
    expect(screen.getByTestId('emoji-picker-inner')).toBeInTheDocument();
  });

  it('calls onSelect when an emoji is clicked', () => {
    render(<EmojiPicker onSelect={onSelect} onClose={onClose} />);
    fireEvent.click(screen.getByTestId('emoji-smile'));
    expect(onSelect).toHaveBeenCalledWith('😊');
  });

  it('calls onSelect with correct emoji for different emojis', () => {
    render(<EmojiPicker onSelect={onSelect} onClose={onClose} />);
    fireEvent.click(screen.getByTestId('emoji-heart'));
    expect(onSelect).toHaveBeenCalledWith('❤️');
  });

  it('calls onClose when clicking outside the picker', () => {
    render(
      <div>
        <div data-testid="outside">Outside</div>
        <EmojiPicker onSelect={onSelect} onClose={onClose} />
      </div>,
    );
    fireEvent.mouseDown(screen.getByTestId('outside'));
    expect(onClose).toHaveBeenCalled();
  });

  it('does not call onClose when clicking inside the picker', () => {
    render(<EmojiPicker onSelect={onSelect} onClose={onClose} />);
    fireEvent.mouseDown(screen.getByTestId('emoji-picker-inner'));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('has emoji-picker-container class', () => {
    const { container } = render(<EmojiPicker onSelect={onSelect} onClose={onClose} />);
    expect(container.querySelector('.emoji-picker-container')).toBeInTheDocument();
  });
});
