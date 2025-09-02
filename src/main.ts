import server from './server';
import logger from './utils/logger';

// FIX 4: Better error handling with more specific logging
process.on('uncaughtException', (error: any) => {
  logger.error('Uncaught Exception:\n' + JSON.stringify({
    message: error.message,
    stack: error.stack,
    name: error.name
  }, null, 2));
  
  // Give some time for logs to flush before exiting
  setTimeout(() => {
    process.exit(1);
  }, 1000);
});

process.on('unhandledRejection', (reason: any, promise: Promise<any>) => {
  logger.error('Unhandled Rejection:\n' + JSON.stringify({
  reason: reason?.message || reason,
  stack: reason?.stack,
  promise: promise.toString()
}, null, 2));
  
  // Don't exit on unhandled rejection in production (Heroku recommendation)
  if (process.env.NODE_ENV !== 'production') {
    setTimeout(() => {
      process.exit(1);
    }, 1000);
  }
});

// FIX 5: Add startup timeout for Heroku
const STARTUP_TIMEOUT = 60000; // 60 seconds

async function startWithTimeout() {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      reject(new Error(`Server startup timed out after ${STARTUP_TIMEOUT}ms`));
    }, STARTUP_TIMEOUT);

    server.start()
      .then((result) => {
        clearTimeout(timeoutId);
        resolve(result);
      })
      .catch((error) => {
        clearTimeout(timeoutId);
        reject(error);
      });
  });
}

// FIX 6: Improved startup with better error handling
async function main() {
  try {
    logger.info('Starting application...');
    logger.info(`Node.js version: ${process.version}`);
    logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);
    logger.info(`Port: ${process.env.PORT || '3000'}`);
    
    await startWithTimeout();
    logger.info('Application started successfully');
    
  } catch (error: any) {
  logger.error('Failed to start application:', error);
  
  // Log environment variables (without sensitive values)
  logger.info('Environment check:');
  logger.info(`  NODE_ENV: ${process.env.NODE_ENV}`);
  logger.info(`  PORT: ${process.env.PORT}`);
  logger.info(`  TELEGRAM_BOT_TOKEN: ${process.env.TELEGRAM_BOT_TOKEN ? '[SET]' : '[MISSING]'}`);
  logger.info(`  TELEGRAM_CHANNEL_ID: ${process.env.TELEGRAM_CHANNEL_ID ? '[SET]' : '[MISSING]'}`);
  logger.info(`  HELIUS_API_KEY: ${process.env.HELIUS_API_KEY ? '[SET]' : '[MISSING]'}`);
  logger.info(`  TOKEN_MINT_ADDRESS: ${process.env.TOKEN_MINT_ADDRESS ? '[SET]' : '[MISSING]'}`);
  logger.info(`  WEBHOOK_URL: ${process.env.WEBHOOK_URL ? '[SET]' : '[NOT SET]'}`);
  
  process.exit(1);
}
}

// Start the application
main();