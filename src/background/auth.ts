const COOKIE_NAME_ADMIN_ACCESS_TOKEN = 'adminAccessToken';
const SETTING_NAME_WEBSOCKET_URL = 'websocket_url';

function normalizeBaseUrl(adminUrl: string): string {
  return adminUrl.trim().replace(/\/+$/, '');
}

export async function loginAdmin(
  adminUrl: string,
  username: string,
  password: string,
): Promise<string> {
  const base = normalizeBaseUrl(adminUrl);
  const body = new URLSearchParams();
  body.set('username', username);
  body.set('password', password);

  await fetch(`${base}/login`, {
    method: 'POST',
    body,
    redirect: 'manual',
    credentials: 'include',
  });

  const cookie = await chrome.cookies.get({
    url: base,
    name: COOKIE_NAME_ADMIN_ACCESS_TOKEN,
  });
  if (!cookie?.value) {
    throw new Error('Sai tài khoản/mật khẩu hoặc URL admin không đúng');
  }
  return cookie.value;
}

export async function fetchWebsocketUrl(adminUrl: string, token: string): Promise<string> {
  const base = normalizeBaseUrl(adminUrl);
  const response = await fetch(
    `${base}/api/v1/settings/names/${SETTING_NAME_WEBSOCKET_URL}`,
    {
      headers: { Authorization: `Bearer ${token}` },
    },
  );
  if (response.status === 401) {
    throw new Error('Token đã hết hạn, vui lòng đăng nhập lại');
  }
  if (!response.ok) {
    throw new Error(`Không lấy được websocket url (HTTP ${response.status})`);
  }
  const data = await response.json();
  const wsUrl = data?.value;
  if (!wsUrl) {
    throw new Error('Server chưa cấu hình websocket_url');
  }
  return wsUrl;
}
