import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useFocusTrap } from './useFocusTrap';

function makeContainer(...elements: HTMLElement[]) {
  const container = document.createElement('div');
  elements.forEach((el) => container.appendChild(el));
  document.body.appendChild(container);
  return container;
}

function fireKey(key: string, opts: Partial<KeyboardEvent> = {}) {
  document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...opts }));
}

describe('useFocusTrap', () => {
  it('does nothing when not active', () => {
    const ref = { current: document.createElement('div') };
    renderHook(() => useFocusTrap(ref, false));
  });

  it('calls onEscape when Escape is pressed', () => {
    const btn = document.createElement('button');
    const container = makeContainer(btn);
    const onEscape = vi.fn();
    renderHook(() => useFocusTrap({ current: container }, true, onEscape));
    fireKey('Escape');
    expect(onEscape).toHaveBeenCalledOnce();
    document.body.removeChild(container);
  });

  it('focuses first focusable element when activated', () => {
    const input = document.createElement('input');
    const container = makeContainer(input);
    renderHook(() => useFocusTrap({ current: container }, true));
    expect(document.activeElement).toBe(input);
    document.body.removeChild(container);
  });

  it('wraps Tab from last to first element', () => {
    const btn1 = document.createElement('button');
    const btn2 = document.createElement('button');
    const container = makeContainer(btn1, btn2);
    renderHook(() => useFocusTrap({ current: container }, true));

    // Focus last element
    btn2.focus();
    expect(document.activeElement).toBe(btn2);

    // Press Tab — should wrap to first
    const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true });
    const pd = vi.spyOn(event, 'preventDefault');
    document.dispatchEvent(event);
    expect(pd).toHaveBeenCalled();
    expect(document.activeElement).toBe(btn1);
    document.body.removeChild(container);
  });

  it('wraps Shift+Tab from first to last element', () => {
    const btn1 = document.createElement('button');
    const btn2 = document.createElement('button');
    const container = makeContainer(btn1, btn2);
    renderHook(() => useFocusTrap({ current: container }, true));

    // Focus should already be on first
    expect(document.activeElement).toBe(btn1);

    // Press Shift+Tab — should wrap to last
    const event = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true });
    const pd = vi.spyOn(event, 'preventDefault');
    document.dispatchEvent(event);
    expect(pd).toHaveBeenCalled();
    expect(document.activeElement).toBe(btn2);
    document.body.removeChild(container);
  });

  it('ignores non-Tab non-Escape keys', () => {
    const btn = document.createElement('button');
    const container = makeContainer(btn);
    renderHook(() => useFocusTrap({ current: container }, true));
    fireKey('a');
    // No error, focus unchanged
    expect(document.activeElement).toBe(btn);
    document.body.removeChild(container);
  });

  it('handles container with no focusable elements', () => {
    const container = makeContainer(); // empty
    renderHook(() => useFocusTrap({ current: container }, true));
    fireKey('Tab');
    // No error
    document.body.removeChild(container);
  });
});
