export interface CommandContext {
  input: unknown;
  variables: Record<string, unknown>;
}

export interface Command<TArgs = unknown> {
  readonly name: string;
  execute(context: CommandContext, args: TArgs): Promise<unknown>;
}

export interface WorkflowStep {
  name: string;
  args?: unknown;
  saveAs?: string;
}

export interface WorkflowPayload {
  version: number;
  input?: unknown;
  commands: WorkflowStep[];
}

export interface WorkflowStepResult {
  index: number;
  name: string;
  data: unknown;
}

export interface WorkflowResult {
  version: number;
  steps: WorkflowStepResult[];
  variables: Record<string, unknown>;
}

export interface WorkflowLog {
  status: string;
  workflowVersion: number;
  stepIndex?: number;
  command?: string;
  durationMs?: number;
  error?: string;
}

export type WorkflowLogListener = (log: WorkflowLog) => void;
