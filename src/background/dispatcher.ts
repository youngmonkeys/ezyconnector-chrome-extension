import { ConnectorLogMessage, EzyRequestMessage, EzyResponseMessage } from './types';
import { handleDomAction, DomActionPayload } from './handlers/dom-automation';
import { handleHttpProxy, HttpProxyPayload } from './handlers/http-proxy';
import { handleNotification, NotificationPayload } from './handlers/notification';
import { browserCommands } from './commands/browser-commands';
import { CommandRegistry } from './commands/command-registry';
import { WorkflowExecutor } from './commands/workflow-executor';
import { WorkflowPayload } from './commands/types';

const commandRegistry = new CommandRegistry();
browserCommands.forEach((command) => commandRegistry.register(command));
commandRegistry.register({
  name: 'http.request',
  execute: (_context, args) => handleHttpProxy(args as HttpProxyPayload),
});
const workflowExecutor = new WorkflowExecutor(commandRegistry);

export async function dispatch(
  message: EzyRequestMessage,
  onLog?: (message: ConnectorLogMessage) => void,
): Promise<EzyResponseMessage> {
  try {
    const data = await route(message, onLog);
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
  onLog?: (message: ConnectorLogMessage) => void,
): Promise<unknown> {
  const { type, payload } = message;

  if (type.startsWith('dom.')) {
    return handleDomAction(type, (payload ?? {}) as DomActionPayload);
  }

  if (type === 'http.request') {
    return handleHttpProxy(payload as HttpProxyPayload);
  }

  if (type === 'notification') {
    return handleNotification((payload ?? {}) as NotificationPayload);
  }

  if (type === 'workflow.execute') {
    return workflowExecutor.execute(
      (payload ?? {}) as WorkflowPayload,
      (log) => onLog?.({ requestId: message.id, ...log }),
    );
  }

  throw new Error(`Unknown request type: ${type}`);
}
