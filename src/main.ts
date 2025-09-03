import server from './server';
import logger from './utils/logger';

// Enhanced error handling with detailed logging
process.on('uncaughtException', (error: any) => {
  logger.error('Uncaught Exception:\n' + JSON.stringify({
    message: error.message,
    stack: error.stack,
    name: error.name,
    code: error.code
  }, null, 2));
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
  if (process.env.NODE_ENV !== 'production') {
    setTimeout(() => {
      process.exit(1);
    }, 1000);
  }
});

// Add process exit handler to log why we're exiting
process.on('exit', (code) => {
  if (code !== 0) {
    console.log('This indicates an error occurred');
  }
});

// Startup with detailed step-by-step logging
async function main() {
  try {
    console.log('🚀 STEP 1: Application starting...');
    logger.info('Starting application...');
    
    console.log(`🔧 STEP 2: Environment check`);
    console.log(`   Node.js version: ${process.version}`);
    console.log(`   Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`   Port: ${process.env.PORT || '3000'}`);
    console.log(`   Memory: ${JSON.stringify(process.memoryUsage())}`);
    
    logger.info(`Node.js version: ${process.version}`);
    logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);
    logger.info(`Port: ${process.env.PORT || '3000'}`);
    
    console.log('🔧 STEP 3: About to call server.start()...');
    
    // Add timeout for the entire startup process
    const startupTimeout = new Promise((_, reject) => {
      setTimeout(() => {
        reject(new Error('Application startup timed out after 45 seconds'));
      }, 45000); // 45 seconds to stay under Heroku's 60s limit
    });
    
    const result = await Promise.race([
      server.start(),
      startupTimeout
    ]);
    logger.info('Application started successfully');
    
  } catch (error: any) {
    
    logger.error('Failed to start application:\n' + JSON.stringify({
      message: error.message,
      stack: error.stack,
      name: error.name,
      code: error.code
    }, null, 2));
    process.exit(1);
  }
}
main();