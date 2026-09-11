interface AdminCredentials {
  adminUrl: string;
  username: string;
  allowedImageOrigins?: string[];
}

const CREDENTIALS_KEY = 'ezyConnectorCredentials';
const CONNECTION_KEY = 'ezyConnectorConnection';
const DATA_CONSENT_KEY = 'ezyConnectorDataConsent';

let dataConsentAccepted = false;
let isConnected = false;
let isLoggingIn = false;

const form = document.getElementById('config-form') as HTMLFormElement;
const adminUrlInput = document.getElementById('admin-url') as HTMLInputElement;
const usernameInput = document.getElementById('username') as HTMLInputElement;
const passwordField = document.getElementById('password-field') as HTMLLabelElement;
const passwordInput = document.getElementById('password') as HTMLInputElement;
const allowedImageOriginsInput = document.getElementById(
  'allowed-image-origins',
) as HTMLTextAreaElement;
const dataConsentInput = document.getElementById('data-consent') as HTMLInputElement;
const dataConsentField = document.getElementById('data-consent-field') as HTMLLabelElement;
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
    allowedImageOriginsInput.value = (credentials.allowedImageOrigins ?? []).join('\n');
  }
}

async function loadDataConsent(): Promise<void> {
  const result = await chrome.storage.local.get(DATA_CONSENT_KEY);
  dataConsentAccepted = result[DATA_CONSENT_KEY] === true;
  renderDataConsent();
  renderLoginButton();
}

function renderDataConsent(): void {
  const hidden = dataConsentAccepted || isConnected;
  dataConsentField.hidden = hidden;
  dataConsentInput.disabled = hidden;
}

function renderLoginButton(): void {
  loginBtn.hidden = isConnected;
  loginBtn.disabled = isConnected
    || isLoggingIn
    || (!dataConsentAccepted && !dataConsentInput.checked);
}

function renderStatus(status: string): void {
  statusDot.className = `dot ${status}`;
  statusText.textContent = STATUS_LABELS[status] ?? status;

  isConnected = status === 'connected';
  adminUrlInput.readOnly = isConnected;
  usernameInput.readOnly = isConnected;
  allowedImageOriginsInput.readOnly = isConnected;
  passwordField.hidden = isConnected;
  passwordInput.disabled = isConnected;
  renderDataConsent();
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

function requestedOriginPattern(origin: string): string {
  const url = new URL(origin);
  return `${url.protocol}//${url.hostname}/*`;
}

function normalizeAdminOrigin(adminUrl: string): string {
  const url = new URL(adminUrl);
  const isLocal = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  if (url.protocol !== 'https:' && !(isLocal && url.protocol === 'http:')) {
    throw new Error('Admin URL phải sử dụng HTTPS (chỉ localhost được phép dùng HTTP)');
  }
  return url.origin;
}

function parseImageOrigins(value: string): string[] {
  const values = value
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);
  return Array.from(new Set(values.map((value) => {
    const url = new URL(value);
    if (url.protocol !== 'https:') {
      throw new Error(`Domain ảnh phải sử dụng HTTPS: ${value}`);
    }
    return url.origin;
  })));
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  clearError();
  isLoggingIn = true;
  renderLoginButton();
  loginBtn.textContent = 'Đang đăng nhập...';
  try {
    if (!dataConsentAccepted && !dataConsentInput.checked) {
      throw new Error('Bạn cần đồng ý cho extension xử lý dữ liệu để tiếp tục');
    }
    const adminOrigin = normalizeAdminOrigin(adminUrlInput.value.trim());
    const allowedImageOrigins = parseImageOrigins(allowedImageOriginsInput.value);
    const requestedOrigins = Array.from(new Set([
      adminOrigin,
      ...allowedImageOrigins,
    ])).map(requestedOriginPattern);
    const granted = await chrome.permissions.request({ origins: requestedOrigins });
    if (!granted) {
      throw new Error('Cần cấp quyền truy cập domain EzyPlatform để đăng nhập và kết nối');
    }
    const response = await chrome.runtime.sendMessage({
      type: 'login',
      adminUrl: adminUrlInput.value.trim(),
      username: usernameInput.value.trim(),
      password: passwordInput.value,
      consentAccepted: dataConsentAccepted || dataConsentInput.checked,
      allowedImageOrigins,
    });
    if (response?.ok) {
      dataConsentAccepted = true;
      renderDataConsent();
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

dataConsentInput.addEventListener('change', renderLoginButton);

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
    if (DATA_CONSENT_KEY in changes) {
      dataConsentAccepted = changes[DATA_CONSENT_KEY].newValue === true;
      renderDataConsent();
      renderLoginButton();
    }
  }
});

loadCredentials();
loadDataConsent();
refreshStatus();
