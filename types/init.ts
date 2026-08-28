export type InitDeps = {
  setSecretFn?: (name: string, value: string) => Promise<void>;
  readKey?: () => Promise<string>;
  runCommand?: (cmd: string[]) => Promise<{ exitCode: number }>;
  write?: (s: string) => void;
  writeConfigFn?: (path: string, contents: string) => Promise<void>;
  configFileExistsFn?: (path: string) => Promise<boolean>;
  confirmFn?: (question: string) => Promise<boolean>;
  isTTYFn?: () => boolean;
};
