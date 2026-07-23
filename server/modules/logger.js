const pino = require('pino');

const logger = pino({
  level: process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug'),
  base: {
    service: process.env.SERVICE_NAME || 'endzone-empire-api',
    environment: process.env.NODE_ENV || 'development',
    release: process.env.RENDER_GIT_COMMIT || process.env.APP_RELEASE || null,
  },
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      '*.password',
      '*.token',
      '*.refreshToken',
      '*.token_hash',
      '*.endpoint',
      '*.keys',
    ],
    censor: '[REDACTED]',
  },
});

function errorFields(error) {
  if (!(error instanceof Error)) return { error };
  return {
    err: error,
    errorName: error.name,
    errorMessage: error.message,
  };
}

function installConsoleBridge() {
  if (global.__ENDZONE_CONSOLE_BRIDGED__) return;
  global.__ENDZONE_CONSOLE_BRIDGED__ = true;

  const write = (level, args) => {
    const error = args.find((value) => value instanceof Error);
    const messageParts = args.filter((value) => typeof value === 'string');
    const values = args.filter(
      (value) => typeof value !== 'string' && !(value instanceof Error)
    );
    logger[level](
      {
        ...(error ? { err: error } : {}),
        ...(values.length ? { legacyValues: values } : {}),
      },
      messageParts.join(' ') || 'legacy console event'
    );
  };

  console.log = (...args) => write('info', args);
  console.info = (...args) => write('info', args);
  console.warn = (...args) => write('warn', args);
  console.error = (...args) => write('error', args);
  console.debug = (...args) => write('debug', args);
}

module.exports = { errorFields, installConsoleBridge, logger };
