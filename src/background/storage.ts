import { AdminCredentials, ConnectionConfig } from './types';

const CREDENTIALS_KEY = 'ezyConnectorCredentials';
const CONNECTION_KEY = 'ezyConnectorConnection';

export async function getCredentials(): Promise<AdminCredentials | null> {
  const result = await chrome.storage.local.get(CREDENTIALS_KEY);
  return (result[CREDENTIALS_KEY] as AdminCredentials | undefined) ?? null;
}

export async function saveCredentials(credentials: AdminCredentials): Promise<void> {
  await chrome.storage.local.set({ [CREDENTIALS_KEY]: credentials });
}

export async function getConnection(): Promise<ConnectionConfig | null> {
  const result = await chrome.storage.local.get(CONNECTION_KEY);
  return (result[CONNECTION_KEY] as ConnectionConfig | undefined) ?? null;
}

export async function saveConnection(config: ConnectionConfig): Promise<void> {
  await chrome.storage.local.set({ [CONNECTION_KEY]: config });
}

export async function clearConnection(): Promise<void> {
  await chrome.storage.local.remove(CONNECTION_KEY);
}

export function onConnectionChanged(callback: (config: ConnectionConfig | null) => void): void {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && CONNECTION_KEY in changes) {
      callback((changes[CONNECTION_KEY].newValue as ConnectionConfig | undefined) ?? null);
    }
  });
}
