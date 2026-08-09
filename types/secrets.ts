export type CommandResult = { stdout: string; exitCode: number };

// Injected command runner (DI, like FetchLike) so tests never touch the real OS keychain.
export type CommandRunner = (cmd: string[], input?: string) => Promise<CommandResult>;
