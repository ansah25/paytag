type Level = 'info' | 'warn' | 'error';

const emit = (level: Level, event: string, data: Record<string, unknown> = {}): void => {
  if (process.env.NODE_ENV === 'test') return;
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    event,
    ...data,
  });
  // eslint-disable-next-line no-console
  (level === 'error' ? console.error : console.log)(line);
};

export const logger = {
  info: (event: string, data?: Record<string, unknown>) => emit('info', event, data),
  warn: (event: string, data?: Record<string, unknown>) => emit('warn', event, data),
  error: (event: string, data?: Record<string, unknown>) => emit('error', event, data),
};
