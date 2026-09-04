import { ConnectionConfig, EzyRequestMessage, EzyResponseMessage } from './types';

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

const MAX_RECONNECT_DELAY_MS = 30000;

export class EzyWebSocketClient {
  private ws: WebSocket | null = null;
  private config: ConnectionConfig | null = null;
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private manuallyClosed = false;

  constructor(
    private readonly onMessage: (message: EzyRequestMessage) => void,
    private readonly onStatusChange: (status: ConnectionStatus) => void,
  ) {}

  connect(config: ConnectionConfig): void {
    this.config = config;
    this.manuallyClosed = false;
    this.reconnectAttempts = 0;
    this.ws?.close();
    this.open();
  }

  disconnect(): void {
    this.manuallyClosed = true;
    this.clearReconnectTimer();
    this.ws?.close();
    this.ws = null;
    this.onStatusChange('disconnected');
  }

  send(message: EzyResponseMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
  }

  private open(): void {
    if (!this.config) return;
    this.onStatusChange('connecting');

    const url = new URL(this.config.wsUrl);
    if (this.config.token) {
      url.searchParams.set('token', this.config.token);
    }

    const ws = new WebSocket(url.toString());
    this.ws = ws;

    ws.addEventListener('open', () => {
      this.reconnectAttempts = 0;
      this.onStatusChange('connected');
    });

    ws.addEventListener('message', (event) => {
      this.handleRawMessage(event.data);
    });

    ws.addEventListener('close', () => {
      this.onStatusChange('disconnected');
      if (!this.manuallyClosed) {
        this.scheduleReconnect();
      }
    });

    ws.addEventListener('error', () => {
      this.onStatusChange('error');
    });
  }

  private handleRawMessage(data: unknown): void {
    if (typeof data !== 'string') return;

    let message: EzyRequestMessage;
    try {
      message = JSON.parse(data);
    } catch {
      return;
    }

    if (!message || typeof message.id !== 'string' || typeof message.type !== 'string') {
      return;
    }

    this.onMessage(message);
  }

  private scheduleReconnect(): void {
    this.clearReconnectTimer();
    const delay = Math.min(MAX_RECONNECT_DELAY_MS, 1000 * 2 ** this.reconnectAttempts);
    this.reconnectAttempts += 1;
    this.reconnectTimer = setTimeout(() => this.open(), delay);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }
}
