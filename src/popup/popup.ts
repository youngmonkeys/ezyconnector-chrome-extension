interface AdminCredentials {
  adminUrl: string;
  username: string;
}

const CREDENTIALS_KEY = 'ezyConnectorCredentials';
const CONNECTION_KEY = 'ezyConnectorConnection';
let isConnected = false;
let isLoggingIn = false;

const form = document.getElementById('config-form') as HTMLFormElement;
const adminUrlInput = document.getElementById('admin-url') as HTMLInputElement;
const usernameInput = document.getElementById('username') as HTMLInputElement;
const passwordField = document.getElementById('password-field') as HTMLLabelElement;
const passwordInput = document.getElementById('password') as HTMLInputElement;
const loginBtn = document.getElementById('login-btn') as HTMLButtonElement;
const disconnectBtn = document.getElementById('disconnect-btn') as HTMLButtonElement;
const statusDot = document.getElementById('status-dot') as HTMLElement;
const statusText = document.getElementById('status-text') as HTMLElement;
const errorMessage = document.getElementById('error-message') as HTMLElement;

const STATUS_LABELS: Record<string, string> = {
  connected: 'Đã kết nối',
  connecting: 'Đang kết nối...',
  disconnected: 'Chưa kết nối',
  error: 'Lỗi kết nối',
};

async function loadCredentials(): Promise<void> {
  const result = await chrome.storage.local.get(CREDENTIALS_KEY);
  const credentials = result[CREDENTIALS_KEY] as AdminCredentials | undefined;
  if (credentials) {
    adminUrlInput.value = credentials.adminUrl ?? '';
    usernameInput.value = credentials.username ?? '';
  }
}

function renderLoginButton(): void {
  loginBtn.hidden = isConnected;
  loginBtn.disabled = isConnected || isLoggingIn;
}

function renderStatus(status: string): void {
  statusDot.className = `dot ${status}`;
  statusText.textContent = STATUS_LABELS[status] ?? status;

  isConnected = status === 'connected';
  adminUrlInput.readOnly = isConnected;
  usernameInput.readOnly = isConnected;
  passwordField.hidden = isConnected;
  passwordInput.disabled = isConnected;
  renderLoginButton();
}

function refreshStatus(): void {
  chrome.runtime.sendMessage({ type: 'getStatus' }, (response) => {
    if (response?.status) {
      renderStatus(response.status);
    }
  });
}

function showError(message: string): void {
  errorMessage.textContent = message;
  errorMessage.hidden = false;
}

function clearError(): void {
  errorMessage.hidden = true;
  errorMessage.textContent = '';
}

function normalizeAdminOrigin(adminUrl: string): string {
  const url = new URL(adminUrl);
  const isLocal = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  if (url.protocol !== 'https:' && !(isLocal && url.protocol === 'http:')) {
    throw new Error('Admin URL phải sử dụng HTTPS (chỉ localhost được phép dùng HTTP)');
  }
  return url.origin;
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  clearError();
  isLoggingIn = true;
  renderLoginButton();
  loginBtn.textContent = 'Đang đăng nhập...';
  try {
    normalizeAdminOrigin(adminUrlInput.value.trim());
    const response = await chrome.runtime.sendMessage({
      type: 'login',
      adminUrl: adminUrlInput.value.trim(),
      username: usernameInput.value.trim(),
      password: passwordInput.value,
    });
    if (response?.ok) {
      passwordInput.value = '';
    } else {
      showError(response?.error ?? 'Đăng nhập thất bại');
    }
  } catch (error) {
    showError(error instanceof Error ? error.message : String(error));
  } finally {
    isLoggingIn = false;
    renderLoginButton();
    loginBtn.textContent = 'Đăng nhập & Kết nối';
  }
});

disconnectBtn.addEventListener('click', async () => {
  clearError();
  await chrome.runtime.sendMessage({ type: 'disconnect' });
  passwordInput.value = '';
});

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === 'status') {
    renderStatus(message.status);
  }
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local') {
    if (CONNECTION_KEY in changes && !changes[CONNECTION_KEY].newValue) {
      renderStatus('disconnected');
    }
  }
});

loadCredentials();
refreshStatus();
