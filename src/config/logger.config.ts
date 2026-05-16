import * as winston from 'winston';

const { combine, timestamp, printf, colorize, errors, json } = winston.format;

const logFormat = printf(({ level, message, timestamp, stack, ...meta }) => {
  let log = `${timestamp} [${level.toUpperCase()}]: ${message}`;
  if (stack) log += `\n${stack}`;
  if (Object.keys(meta).length) log += ` ${JSON.stringify(meta)}`;
  return log;
});

export const winstonConfig: winston.LoggerOptions = {
  level: process.env.LOG_LEVEL || 'info',
  format: combine(
    errors({ stack: true }),
    timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    process.env.NODE_ENV === 'production' ? json() : combine(colorize(), logFormat),
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({
      filename: `${process.env.LOG_DIR || './logs'}/error.log`,
      level: 'error',
      maxsize: 5242880, // 5MB
      maxFiles: 10,
    }),
    new winston.transports.File({
      filename: `${process.env.LOG_DIR || './logs'}/combined.log`,
      maxsize: 10485760, // 10MB
      maxFiles: 10,
    }),
  ],
  exceptionHandlers: [
    new winston.transports.File({
      filename: `${process.env.LOG_DIR || './logs'}/exceptions.log`,
    }),
  ],
  rejectionHandlers: [
    new winston.transports.File({
      filename: `${process.env.LOG_DIR || './logs'}/rejections.log`,
    }),
  ],
};
