export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export type LogContext = {
  operation?: string;
  toolName?: string;
  endpoint?: string;
  method?: string;
  statusCode?: number;
  error?: string;
  [key: string]: unknown;
};
