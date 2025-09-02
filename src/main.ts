import server from './server';
import logger from './utils/logger';

process.on('uncaughtException', (error: any) => {
    logger.error('Uncaught Exception:', error);
    process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
    logger.error(`Unhandled Rejection at: ${promise} reason: ${reason}`);
});

// Start the application
server.start().catch((error) => {
    logger.error('Failed to start server:', error);
    process.exit(1);
});
