import { executeWorkflow } from './workflow';
import { EzyRequestMessage, EzyResponseMessage, WorkflowPayload } from './types';

export async function dispatch(
  message: EzyRequestMessage,
  adminOrigin: string,
  allowedImageOrigins: string[],
): Promise<EzyResponseMessage> {
  try {
    if (message.type !== 'workflow.execute') {
      throw new Error(`Unknown request type: ${message.type}`);
    }
    const data = await executeWorkflow(
      message.payload as WorkflowPayload,
      adminOrigin,
      allowedImageOrigins,
    );
    return { id: message.id, ok: true, data };
  } catch (error) {
    return {
      id: message.id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
