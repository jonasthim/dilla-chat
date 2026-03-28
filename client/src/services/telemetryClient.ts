import { ws } from './websocket';
import { useTelemetryStore } from '../stores/telemetryStore';

interface Breadcrumb {
  type: string;
  message: string;
  data?: Record<string, unknown>;
  timestamp: string;
}

export class TelemetryClient {
  private breadcrumbs: Breadcrumb[] = [];
  private teamId: string;

  private static readonly MAX_BREADCRUMBS = 20;

  constructor(teamId: string) {
    this.teamId = teamId;
  }

  setTeamId(teamId: string): void {
    this.teamId = teamId;
  }

  addBreadcrumb(type: string, message: string, data?: Record<string, unknown>): void {
    this.breadcrumbs.push({
      type,
      message,
      data,
      timestamp: new Date().toISOString(),
    });
    if (this.breadcrumbs.length > TelemetryClient.MAX_BREADCRUMBS) {
      this.breadcrumbs = this.breadcrumbs.slice(-TelemetryClient.MAX_BREADCRUMBS);
    }
  }

  captureError(error: Error | string, tags?: Record<string, string>): void {
    if (!useTelemetryStore.getState().enabled) return;
    if (!ws.isConnected(this.teamId)) return;

    const isError = error instanceof Error;
    const message = isError ? error.message : error;
    const stack = isError ? error.stack : undefined;

    ws.send(this.teamId, {
      type: 'telemetry:error',
      payload: {
        level: 'error',
        message,
        stack,
        tags,
        breadcrumbs: [...this.breadcrumbs],
        context: {
          browser: navigator.userAgent,
          os: navigator.platform,
          url: location.href,
          viewport: `${innerWidth}x${innerHeight}`,
        },
        timestamp: new Date().toISOString(),
      },
    });
  }

  install(): void {
    window.addEventListener('error', (event: ErrorEvent) => {
      this.captureError(event.error instanceof Error ? event.error : String(event.message));
    });

    window.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => {
      const reason = event.reason;
      this.captureError(reason instanceof Error ? reason : String(reason));
    });
  }
}

export const telemetryClient = new TelemetryClient('');
