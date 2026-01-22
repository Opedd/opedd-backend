import winston from 'winston';

const { combine, timestamp, json, errors } = winston.format;

export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: combine(
    errors({ stack: true }),
    timestamp(),
    json()
  ),
  defaultMeta: { service: 'opedd-api' },
  transports: [
    new winston.transports.Console()  // Always console (Vercel-safe)
  ]
  // File transports DISABLED for serverless (read-only FS)
  // if (process.env.NODE_ENV === 'production') {
  //   logger.add(new winston.transports.File({ filename: 'logs/error.log

