import { Command, CommandContext } from './types';

export class CommandRegistry {
  private readonly commands = new Map<string, Command>();

  register(command: Command): this {
    if (this.commands.has(command.name)) {
      throw new Error(`Command is already registered: ${command.name}`);
    }
    this.commands.set(command.name, command);
    return this;
  }

  execute(name: string, context: CommandContext, args: unknown): Promise<unknown> {
    const command = this.commands.get(name);
    if (!command) {
      throw new Error(`Unsupported command: ${name}`);
    }
    return command.execute(context, args);
  }
}
