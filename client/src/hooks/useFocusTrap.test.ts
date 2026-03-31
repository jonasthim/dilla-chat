import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useFocusTrap } from './useFocusTrap';

describe('useFocusTrap', () => {
  it('does nothing when not active', () => {
    const ref = { current: document.createElement('div') };
    renderHook(() => useFocusTrap(ref, false));
    // No errors thrown
  });

  it('calls onEscape when Escape is pressed', () => {
    const container = document.createElement('div');
    const button = document.createElement('button');
    container.appendChild(button);
    document.body.appendChild(container);

    const onEscape = vi.fn();
    const ref = { current: container };

    renderHook(() => useFocusTrap(ref, true, onEscape));

    const event = new KeyboardEvent('keydown', { key: 'Escape' });
    document.dispatchEvent(event);
    expect(onEscape).toHaveBeenCalledOnce();

    document.body.removeChild(container);
  });

  it('focuses first focusable element when activated', () => {
    const container = document.createElement('div');
    const input = document.createElement('input');
    container.appendChild(input);
    document.body.appendChild(container);

    const ref = { current: container };
    renderHook(() => useFocusTrap(ref, true));

    expect(document.activeElement).toBe(input);

    document.body.removeChild(container);
  });
});
