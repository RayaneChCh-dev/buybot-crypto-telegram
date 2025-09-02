import server from './server';
import logger from './utils/logger';

// Enhanced error handling with detailed logging
process.on('uncaughtException', (error: any) => {
  console.error('🚨 UNCAUGHT EXCEPTION:');
  console.error('Message:', error.message);
  console.error('Stack:', error.stack);
  console.error('Name:', error.name);
  console.error('Code:', error.code);
  
  logger.error('Uncaught Exception:\n' + JSON.stringify({
    message: error.message,
    stack: error.stack,
    name: error.name,
    code: error.code
  }, null, 2));
  
  // Give time for logs to flush
  setTimeout(() => {
    process.exit(1);
  }, 1000);
});

process.on('unhandledRejection', (reason: any, promise: Promise<any>) => {
  console.error('🚨 UNHANDLED REJECTION:');
  console.error('Reason:', reason?.message || reason);
  console.error('Stack:', reason?.stack);
  console.error('Promise:', promise);
  
  logger.error('Unhandled Rejection:\n' + JSON.stringify({
    reason: reason?.message || reason,
    stack: reason?.stack,
    promise: promise.toString()
  }, null, 2));
  
  // Don't exit on unhandled rejection in production immediately
  // Let's see what the actual error is first
  if (process.env.NODE_ENV !== 'production') {
    setTimeout(() => {
      process.exit(1);
    }, 1000);
  }
});

// Add process exit handler to log why we're exiting
process.on('exit', (code) => {
  console.log(`🔄 Process exiting with code: ${code}`);
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
        console.error('🚨 STARTUP TIMEOUT after 45 seconds');
        reject(new Error('Application startup timed out after 45 seconds'));
      }, 45000); // 45 seconds to stay under Heroku's 60s limit
    });
    
    console.log('🔧 STEP 4: Starting server with timeout...');
    
    const result = await Promise.race([
      server.start(),
      startupTimeout
    ]);
    
    console.log('✅ STEP 5: Server started successfully!');
    console.log('Result:', result ? 'Server object returned' : 'No result');
    
    logger.info('Application started successfully');
    
    // Keep process alive
    console.log('🎯 STEP 6: Application is now running and ready to receive requests');
    
  } catch (error: any) {
    console.error('❌ APPLICATION STARTUP FAILED:');
    console.error('Error message:', error.message);
    console.error('Error name:', error.name);
    console.error('Error code:', error.code);
    console.error('Error stack:', error.stack);
    
    logger.error('Failed to start application:\n' + JSON.stringify({
      message: error.message,
      stack: error.stack,
      name: error.name,
      code: error.code
    }, null, 2));
    
    // Enhanced environment debugging
    console.error('🔍 ENVIRONMENT DEBUG INFO:');
    console.error('NODE_ENV:', process.env.NODE_ENV);
    console.error('PORT:', process.env.PORT);
    console.error('TELEGRAM_BOT_TOKEN:', process.env.TELEGRAM_BOT_TOKEN ? '[SET]' : '[MISSING]');
    console.error('TELEGRAM_CHANNEL_ID:', process.env.TELEGRAM_CHANNEL_ID ? '[SET]' : '[MISSING]');
    console.error('HELIUS_API_KEY:', process.env.HELIUS_API_KEY ? '[SET]' : '[MISSING]');
    console.error('TOKEN_MINT_ADDRESS:', process.env.TOKEN_MINT_ADDRESS ? '[SET]' : '[MISSING]');
    console.error('WEBHOOK_URL:', process.env.WEBHOOK_URL ? '[SET]' : '[NOT SET]');
    console.error('ENABLE_POLLING:', process.env.ENABLE_POLLING);
    
    logger.info('Environment check:');
  logger.info(`  NODE_ENV: ${process.env.NODE_ENV}`);
  logger.info(`  PORT: ${process.env.PORT}`);
  logger.info(`  TELEGRAM_BOT_TOKEN: ${process.env.TELEGRAM_BOT_TOKEN ? '[SET]' : '[MISSING]'}`);
  logger.info(`  TELEGRAM_CHANNEL_ID: ${process.env.TELEGRAM_CHANNEL_ID ? '[SET]' : '[MISSING]'}`);
  logger.info(`  HELIUS_API_KEY: ${process.env.HELIUS_API_KEY ? '[SET]' : '[MISSING]'}`);
  logger.info(`  TOKEN_MINT_ADDRESS: ${process.env.TOKEN_MINT_ADDRESS ? '[SET]' : '[MISSING]'}`);
  logger.info(`  WEBHOOK_URL: ${process.env.WEBHOOK_URL ? '[SET]' : '[NOT SET]'}`);
    
    console.error('🚨 EXITING WITH STATUS 1');
    process.exit(1);
  }
}

// Add some basic health checks before starting
console.log('🔍 PRE-FLIGHT CHECKS:');
console.log('- Current working directory:', process.cwd());
console.log('- Node.js version:', process.version);
console.log('- Platform:', process.platform);
console.log('- Architecture:', process.arch);
console.log('- PID:', process.pid);

// Start the application
console.log('🚀 CALLING main() function...');
main();