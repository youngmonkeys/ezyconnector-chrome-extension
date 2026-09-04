interface ConnectionConfig {
  wsUrl: string;
  token: string;
}

const STORAGE_KEY = 'ezyConnectorConfig';

const form = document.getElementById('config-form') as HTMLFormElement;
const wsUrlInput = document.getElementById('ws-url') as HTMLInputElement;
const tokenInput = document.getElementById('token') as HTMLInputElement;
const disconnectBtn = document.getElementById('disconnect-btn') as HTMLButtonElement;
const statusDot = document.getElementById('status-dot') as HTMLElement;
const statusText = document.getElementById('status-text') as HTMLElement;

const STATUS_LABELS: Record<string, string> = {
  connected: 'Đã kết nối',
  connecting: 'Đang kết nối...',
  disconnected: 'Chưa kết nối',
  error: 'Lỗi kết nối',
};

async function loadConfig(): Promise<void> {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  const config = result[STORAGE_KEY] as ConnectionConfig | undefined;
  if (config) {
    wsUrlInput.value = config.wsUrl ?? '';
    tokenInput.value = config.token ?? '';
  }
}

function renderStatus(status: string): void {
  statusDot.className = `dot ${status}`;
  statusText.textContent = STATUS_LABELS[status] ?? status;
}

function refreshStatus(): void {
  chrome.runtime.sendMessage({ type: 'getStatus' }, (response) => {
    if (response?.status) {
      renderStatus(response.status);
    }
  });
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const config: ConnectionConfig = {
    wsUrl: wsUrlInput.value.trim(),
    token: tokenInput.value.trim(),
  };
  await chrome.storage.local.set({ [STORAGE_KEY]: config });
});

disconnectBtn.addEventListener('click', async () => {
  await chrome.storage.local.remove(STORAGE_KEY);
  wsUrlInput.value = '';
  tokenInput.value = '';
});

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === 'status') {
    renderStatus(message.status);
  }
});

loadConfig();
refreshStatus();
