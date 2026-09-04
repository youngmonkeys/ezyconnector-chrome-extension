export interface EzyRequestMessage {
  id: string;
  type: string;
  payload?: unknown;
}

export interface EzyResponseMessage {
  id: string;
  ok: boolean;
  data?: unknown;
  error?: string;
}

export interface ConnectionConfig {
  wsUrl: string;
  token: string;
}
