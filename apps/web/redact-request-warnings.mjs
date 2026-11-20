// Next's Proxy body buffer emits this warning directly, outside request logging.
const warn = console.warn;
console.warn = (...args) => {
  const [message] = args;
  if (
    typeof message === 'string' &&
    message.startsWith('Request body exceeded ') &&
    message.includes('middlewareClientMaxBodySize')
  ) {
    warn('Request body exceeded the Next.js Proxy buffer limit.');
    return;
  }
  warn(...args);
};
