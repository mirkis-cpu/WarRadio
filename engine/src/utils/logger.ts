import pino from 'pino';
import { getConfig } from '../config.js';

export const logger = pino({
  level: getConfig().LOG_LEVEL,
  transport: {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'HH:MM:ss',
      ignore: 'pid,hostname',
    },
  },
});
