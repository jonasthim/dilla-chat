import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./websocket', () => ({
  ws: { send: vi.fn(), isConnected: vi.fn(() => true) },
}));

vi.mock('../stores/telemetryStore', () => ({
  useTelemetryStore: { getState: vi.fn(() => ({ enabled: true })) },
}));

import { TelemetryClient } from './telemetryClient';
import { ws } from './websocket';
import { useTelemetryStore } from '../stores/telemetryStore';

describe('TelemetryClient', () => {
  let client: TelemetryClient;

  beforeEach(() => {
    vi.clearAllMocks();
    client = new TelemetryClient('team-1');
  });

  it('captureError sends telemetry:error via WS', () => {
    client.captureError(new Error('boom'));

    expect(ws.send).toHaveBeenCalledTimes(1);
    const [teamId, event] = vi.mocked(ws.send).mock.calls[0];
    expect(teamId).toBe('team-1');
    expect(event.type).toBe('telemetry:error');
    expect(event.payload.message).toBe('boom');
    expect(event.payload.level).toBe('error');
    expect(event.payload.stack).toBeDefined();
    expect(event.payload.timestamp).toBeDefined();
    expect(event.payload.context).toBeDefined();
  });

  it('includes breadcrumbs in error event', () => {
    client.addBreadcrumb('navigation', '/home');
    client.addBreadcrumb('click', 'submit button', { form: 'login' });
    client.captureError('test error');

    const [, event] = vi.mocked(ws.send).mock.calls[0];
    const breadcrumbs = event.payload.breadcrumbs as unknown[];
    expect(breadcrumbs).toHaveLength(2);
    expect(breadcrumbs[0]).toMatchObject({ type: 'navigation', message: '/home' });
    expect(breadcrumbs[1]).toMatchObject({ type: 'click', message: 'submit button', data: { form: 'login' } });
  });

  it('limits breadcrumb buffer to 20', () => {
    for (let i = 0; i < 25; i++) {
      client.addBreadcrumb('nav', `page-${i}`);
    }
    client.captureError('overflow');

    const [, event] = vi.mocked(ws.send).mock.calls[0];
    const breadcrumbs = event.payload.breadcrumbs as Array<{ message: string }>;
    expect(breadcrumbs).toHaveLength(20);
    // Should keep the last 20 (indices 5-24)
    expect(breadcrumbs[0].message).toBe('page-5');
    expect(breadcrumbs[19].message).toBe('page-24');
  });

  it('does not send when opted out', () => {
    vi.mocked(useTelemetryStore.getState).mockReturnValue({ enabled: false, setEnabled: vi.fn() });

    client.captureError('ignored');
    expect(ws.send).not.toHaveBeenCalled();
  });

  it('does not send when WS disconnected', () => {
    vi.mocked(ws.isConnected).mockReturnValue(false);

    client.captureError('dropped');
    expect(ws.send).not.toHaveBeenCalled();
  });
});
