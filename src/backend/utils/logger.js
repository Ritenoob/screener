/**
 * Logger utility using pino
 */

import pino from 'pino';

export function createLogger(name) {
  return pino({
    name,
    level: process.env.LOG_LEVEL || 'info',
    transport: {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'HH:MM:ss Z',
        ignore: 'pid,hostname'
      }
    }
  });
}

export default createLogger;
