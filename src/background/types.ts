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

export interface AdminCredentials {
  adminUrl: string;
  username: string;
}

export interface ConnectionConfig {
  adminUrl: string;
  wsUrl: string;
  token: string;
}
