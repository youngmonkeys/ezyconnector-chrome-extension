import { EzyWebSocketClient, ConnectionStatus } from './websocket-client';
import { dispatch } from './dispatcher';
import {
  clearConnection,
  getConnection,
  hasDataConsent,
  onConnectionChanged,
  saveConnection,
  saveCredentials,
  setDataConsent,
} from './storage';
import { fetchWebsocketUrl, loginAdmin, normalizeImageOrigins } from './auth';
import { EzyRequestMessage } from './types';

let status: ConnectionStatus = 'disconnected';

const client = new EzyWebSocketClient(
  async (message: EzyRequestMessage) => {
    const connection = await getConnection();
    if (!connection) return;
    const response = await dispatch(
      message,
      new URL(connection.adminUrl).origin,
      connection.allowedImageOrigins ?? [],
    );
    client.send(response);
  },
  (newStatus) => {
    status = newStatus;
    chrome.runtime.sendMessage({ type: 'status', status: newStatus }).catch(() => {});
  },
);

async function start(): Promise<void> {
  if (!(await hasDataConsent())) return;
  const connection = await getConnection();
  if (connection?.wsUrl) {
    client.connect(connection);
  }
}

onConnectionChanged((connection) => {
  if (connection?.wsUrl) {
    client.connect(connection);
  } else {
    client.disconnect();
  }
});

async function handleLogin(
  adminUrl: string,
  username: string,
  password: string,
  consentAccepted: boolean,
  allowedImageOrigins: unknown,
): Promise<{ ok: boolean; error?: string }> {
  try {
    if (!consentAccepted) {
      throw new Error('Bạn cần đồng ý cho extension xử lý dữ liệu để sử dụng tính năng này');
    }
    const normalizedImageOrigins = normalizeImageOrigins(allowedImageOrigins);
    const token = await loginAdmin(adminUrl, username, password);
    const wsUrl = await fetchWebsocketUrl(adminUrl, token);
    await saveCredentials({
      adminUrl,
      username,
      allowedImageOrigins: normalizedImageOrigins,
    });
    await setDataConsent(true);
    await saveConnection({
      adminUrl,
      token,
      wsUrl,
      allowedImageOrigins: normalizedImageOrigins,
    });
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

async function handleDisconnect(): Promise<{ ok: boolean }> {
  await clearConnection();
  return { ok: true };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'getStatus') {
    sendResponse({ status });
    return true;
  }
  if (message?.type === 'login') {
    handleLogin(
      message.adminUrl,
      message.username,
      message.password,
      message.consentAccepted === true,
      message.allowedImageOrigins,
    ).then(sendResponse);
    return true;
  }
  if (message?.type === 'disconnect') {
    handleDisconnect().then(sendResponse);
    return true;
  }
  if (message?.type === 'reconnect') {
    start();
    return true;
  }
  return false;
});

chrome.runtime.onStartup.addListener(start);
chrome.runtime.onInstalled.addListener(start);

start();
