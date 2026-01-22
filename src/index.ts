import dotenv from 'dotenv';
dotenv.config();

import app from './app';
import { logger } from './utils/logger';

const PORT = process.env.PORT || 3000;

// Only start server when not in Vercel serverless environment
if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    logger.info(`Server started on port ${PORT}`, {
      environment: process.env.NODE_ENV || 'development',
      port: PORT,
    });
  });
}

// Export for Vercel serverless
export default app;
