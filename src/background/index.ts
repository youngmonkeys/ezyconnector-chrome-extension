import { EzyWebSocketClient, ConnectionStatus } from './websocket-client';
import { dispatch } from './dispatcher';
import { getConnection, onConnectionChanged, saveConnection, saveCredentials, clearConnection } from './storage';
import { loginAdmin, fetchWebsocketUrl } from './auth';
import { EzyRequestMessage } from './types';

let status: ConnectionStatus = 'disconnected';

const client = new EzyWebSocketClient(
  async (message: EzyRequestMessage) => {
    const response = await dispatch(message, (log) => client.sendLog(log));
    client.send(response);
  },
  (newStatus) => {
    status = newStatus;
    chrome.runtime.sendMessage({ type: 'status', status: newStatus }).catch(() => {});
  },
);

async function start(): Promise<void> {
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
): Promise<{ ok: boolean; error?: string }> {
  try {
    const token = await loginAdmin(adminUrl, username, password);
    const wsUrl = await fetchWebsocketUrl(adminUrl, token);
    await saveCredentials({ adminUrl, username });
    await saveConnection({ adminUrl, token, wsUrl });
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
    handleLogin(message.adminUrl, message.username, message.password).then(sendResponse);
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
