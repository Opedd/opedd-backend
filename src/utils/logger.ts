import winston from 'winston';

const { combine, timestamp, json, errors, colorize, simple } = winston.format;

// Check if we are in a serverless environment (Vercel)
const isProduction = process.env.NODE_ENV === 'production' || process.env.VERCEL;

export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: combine(
    errors({ stack: true }),
    timestamp(),
    json()
  ),
  defaultMeta: { service: 'opedd-backend' },
  transports: [
    // Always log to the console (Vercel captures this automatically)
    new winston.transports.Console({
      format: isProduction 
        ? json() 
        : combine(colorize(), simple())
    })
  ]
});

// Only add file logging if NOT on Vercel/Production
if (!isProduction) {
  try {
    logger.add(
      new winston.transports.File({ 
        filename: 'logs/error.log', 
        level: 'error' 
      })
    );
    logger.add(
      new winston.transports.File({ 
        filename: 'logs/combined.log' 
      })
    );
  } catch (err) {
    console.warn('Local file logging failed to initialize:', err.message);
  }
}

export default logger;
