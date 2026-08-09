export type InitDeps = {
  setSecretFn?: (name: string, value: string) => Promise<void>;
  readKey?: () => Promise<string>;
  runCommand?: (cmd: string[]) => Promise<{ exitCode: number }>;
  write?: (s: string) => void;
};
