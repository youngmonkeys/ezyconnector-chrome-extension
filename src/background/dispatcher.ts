import { EzyRequestMessage, EzyResponseMessage } from './types';
import { handleDomAction, DomActionPayload } from './handlers/dom-automation';
import { handleHttpProxy, HttpProxyPayload } from './handlers/http-proxy';

export async function dispatch(message: EzyRequestMessage): Promise<EzyResponseMessage> {
  try {
    const data = await route(message);
    return { id: message.id, ok: true, data };
  } catch (error) {
    return {
      id: message.id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function route(message: EzyRequestMessage): Promise<unknown> {
  const { type, payload } = message;

  if (type.startsWith('dom.')) {
    return handleDomAction(type, (payload ?? {}) as DomActionPayload);
  }

  if (type === 'http.request') {
    return handleHttpProxy(payload as HttpProxyPayload);
  }

  throw new Error(`Unknown request type: ${type}`);
}
