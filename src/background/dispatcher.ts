import { EzyRequestMessage, EzyResponseMessage } from './types';
import { handleZaloOaSendMessage, ZaloOaSendMessagePayload } from './handlers/notification';

export async function dispatch(
  message: EzyRequestMessage,
  adminOrigin: string,
  allowedImageOrigins: string[],
): Promise<EzyResponseMessage> {
  try {
    const data = await route(message, adminOrigin, allowedImageOrigins);
    return { id: message.id, ok: true, data };
  } catch (error) {
    return {
      id: message.id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function route(
  message: EzyRequestMessage,
  adminOrigin: string,
  allowedImageOrigins: string[],
): Promise<unknown> {
  const { type, payload } = message;

  if (type === 'zaloOa.sendMessage') {
    return handleZaloOaSendMessage(
      (payload ?? {}) as ZaloOaSendMessagePayload,
      adminOrigin,
      allowedImageOrigins,
    );
  }

  throw new Error(`Unknown request type: ${type}`);
}
