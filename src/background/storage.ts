import { ConnectionConfig } from './types';

const STORAGE_KEY = 'ezyConnectorConfig';

export async function getConfig(): Promise<ConnectionConfig | null> {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  return (result[STORAGE_KEY] as ConnectionConfig | undefined) ?? null;
}

export function onConfigChanged(callback: (config: ConnectionConfig | null) => void): void {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && STORAGE_KEY in changes) {
      callback((changes[STORAGE_KEY].newValue as ConnectionConfig | undefined) ?? null);
    }
  });
}
