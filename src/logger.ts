import type { LogLevel, LogContext } from '@types';

const REDACTED_KEYS = new Set([
  'apiKey',
  'api_key',
  'PLANE_API_KEY',
  'PLANE_WORKSPACE_SLUG',
  'authorization',
  'Authorization',
]);

function redact(context: LogContext): LogContext {
  const result: LogContext = {};
  for (const [key, value] of Object.entries(context)) {
    result[key] = REDACTED_KEYS.has(key) ? '[REDACTED]' : value;
  }
  return result;
}

export function log(level: LogLevel, message: string, context?: LogContext): void {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...(context ? redact(context) : {}),
  };
  process.stderr.write(JSON.stringify(entry) + '\n');
}
