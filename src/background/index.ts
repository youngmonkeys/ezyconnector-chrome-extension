import { EzyWebSocketClient, ConnectionStatus } from './websocket-client';
import { dispatch } from './dispatcher';
import { getConfig, onConfigChanged } from './storage';
import { EzyRequestMessage } from './types';

let status: ConnectionStatus = 'disconnected';

const client = new EzyWebSocketClient(
  async (message: EzyRequestMessage) => {
    const response = await dispatch(message);
    client.send(response);
  },
  (newStatus) => {
    status = newStatus;
    chrome.runtime.sendMessage({ type: 'status', status: newStatus }).catch(() => {});
  },
);

async function start(): Promise<void> {
  const config = await getConfig();
  if (config?.wsUrl) {
    client.connect(config);
  }
}

onConfigChanged((config) => {
  if (config?.wsUrl) {
    client.connect(config);
  } else {
    client.disconnect();
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'getStatus') {
    sendResponse({ status });
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
