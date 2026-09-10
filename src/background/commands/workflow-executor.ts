import { CommandRegistry } from './command-registry';
import {
  CommandContext,
  WorkflowPayload,
  WorkflowResult,
  WorkflowStep,
  WorkflowLogListener,
} from './types';

const MAX_COMMANDS = 100;
const VARIABLE_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const EXACT_REFERENCE_PATTERN = /^\$\{([^}]+)\}$/;
const REFERENCE_PATTERN = /\$\{([^}]+)\}/g;

function readPath(context: CommandContext, path: string): unknown {
  const parts = path.split('.');
  let value: unknown = parts[0] === 'input'
    ? context.input
    : context.variables[parts.shift() as string];

  for (const part of parts) {
    if (!value || typeof value !== 'object') return undefined;
    value = (value as Record<string, unknown>)[part];
  }
  return value;
}

function resolveValue(value: unknown, context: CommandContext): unknown {
  if (typeof value === 'string') {
    const exactReference = value.match(EXACT_REFERENCE_PATTERN);
    if (exactReference) {
      const resolved = readPath(context, exactReference[1]);
      if (resolved === undefined) {
        throw new Error(`Unknown workflow reference: ${exactReference[1]}`);
      }
      return resolved;
    }
    return value.replace(REFERENCE_PATTERN, (_match, path: string) => {
      const resolved = readPath(context, path);
      if (resolved === undefined) throw new Error(`Unknown workflow reference: ${path}`);
      return String(resolved);
    });
  }
  if (Array.isArray(value)) return value.map((item) => resolveValue(item, context));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, resolveValue(item, context)]),
    );
  }
  return value;
}

function validateStep(step: WorkflowStep, index: number): void {
  if (!step || typeof step.name !== 'string' || !step.name) {
    throw new Error(`commands[${index}].name is required`);
  }
  if (step.saveAs !== undefined && !VARIABLE_NAME_PATTERN.test(step.saveAs)) {
    throw new Error(`commands[${index}].saveAs is invalid`);
  }
}

export class WorkflowExecutor {
  constructor(private readonly registry: CommandRegistry) {}

  async execute(
    payload: WorkflowPayload,
    onLog?: WorkflowLogListener,
  ): Promise<WorkflowResult> {
    if (payload?.version !== 1) throw new Error('Unsupported workflow version');
    if (!Array.isArray(payload.commands)) throw new Error('commands must be an array');
    if (payload.commands.length > MAX_COMMANDS) {
      throw new Error(`Workflow cannot contain more than ${MAX_COMMANDS} commands`);
    }

    const context: CommandContext = { input: payload.input ?? null, variables: {} };
    const steps = [];
    const workflowStartedAt = Date.now();
    onLog?.({
      status: 'workflow.started',
      workflowVersion: payload.version,
    });
    for (let index = 0; index < payload.commands.length; ++index) {
      const step = payload.commands[index];
      validateStep(step, index);
      const stepStartedAt = Date.now();
      onLog?.({
        status: 'command.started',
        workflowVersion: payload.version,
        stepIndex: index,
        command: step.name,
      });
      try {
        const data = await this.registry.execute(
          step.name,
          context,
          resolveValue(step.args ?? {}, context),
        );
        if (step.saveAs) context.variables[step.saveAs] = data;
        steps.push({ index, name: step.name, data });
        onLog?.({
          status: 'command.succeeded',
          workflowVersion: payload.version,
          stepIndex: index,
          command: step.name,
          durationMs: Date.now() - stepStartedAt,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        onLog?.({
          status: 'command.failed',
          workflowVersion: payload.version,
          stepIndex: index,
          command: step.name,
          durationMs: Date.now() - stepStartedAt,
          error: message,
        });
        throw new Error(`Command ${index} (${step.name}) failed: ${message}`);
      }
    }

    onLog?.({
      status: 'workflow.succeeded',
      workflowVersion: payload.version,
      durationMs: Date.now() - workflowStartedAt,
    });
    return { version: payload.version, steps, variables: context.variables };
  }
}
