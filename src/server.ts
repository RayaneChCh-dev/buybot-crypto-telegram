import express from 'express';
import cors from 'cors';
import { Request, Response, NextFunction } from 'express';

import config from './config';
import logger from './utils/logger';
import botService from './services/botService';
import helius from './services/helius';
import telegram from './services/telegram';
import { webhookLimiter, validateWebhookSource, validateWebhookPayload } from './middleware/validation';


const app = express();

const PORT = process.env.PORT;

// Middleware
app.use(express.json({ limit: '10mb' }));
app.use(cors());

// Request logging middleware
app.use((req, res, next) => {
    logger.debug(`${req.method} ${req.path} - IP: ${req.ip} - User Agent: ${req.get('User-Agent')}`);
    next();
});

// Health check endpoint
app.get('/health', (req, res) => {
    const status = botService.getStatus();
    res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        config: {
            token: config.token.symbol,
            polling: config.features.enablePolling,
            webhook: !!config.helius.webhookUrl,
            environment: config.server.environment
        },
        ...status
    });
});

// Main webhook endpoint
app.post('/webhook', 
    webhookLimiter,
    validateWebhookSource,
    validateWebhookPayload,
    async (req, res) => {
        const startTime = Date.now();
        
        try {
            logger.info(`Webhook received ${req.body.length} transactions`);
            
            const processedCount = await botService.processWebhookData(req.body);
            const duration = Date.now() - startTime;
            
            logger.info(`Webhook processed: ${processedCount}/${req.body.length} in ${duration}ms`);
            
            res.json({ 
                success: true, 
                processed: processedCount,
                total: req.body.length,
                duration: `${duration}ms`
            });
        } catch (error: any) {
            const duration = Date.now() - startTime;
            logger.error(`Webhook processing error: ${error.message} (duration: ${duration}ms, transactionCount: ${req.body.length})`);
            
            res.status(500).json({ 
                error: 'Processing failed',
                message: error.message 
            });
        }
    }
);

// Test endpoints
app.get('/test', async (req, res) => {
    try {
        const testMessage = '🧪 **Test Message**\n\nBot is working correctly!';
        
        await telegram.bot.sendMessage(
            config.telegram.channelId, 
            testMessage, 
            { parse_mode: 'Markdown' }
        );
        
        logger.info('Test message sent successfully');
        res.json({ 
            success: true,
            message: 'Test message sent to channel',
            channelId: config.telegram.channelId
        });
    } catch (error: any) {
        logger.error('Test message failed:', error);
        res.status(500).json({ 
            success: false,
            error: error.message 
        });
    }
});

// Get active webhooks
app.get('/webhooks', async (req, res) => {
    try {
        const webhooks = await helius.getWebhooks();
        res.json({
            success: true,
            webhooks: webhooks,
            count: webhooks.length
        });
    } catch (error: any) {
        logger.error('Failed to fetch webhooks:', error);
        res.status(500).json({ 
            success: false,
            error: error.message 
        });
    }
});

// Stats endpoint
app.get('/stats', (req, res) => {
    try {
        const status = botService.getStatus();
        const stats = telegram.getStats();
        
        res.json({
            success: true,
            bot: status,
            telegram: stats,
            system: {
                uptime: process.uptime(),
                memory: process.memoryUsage(),
                version: process.version
            }
        });
    } catch (error: any) {
        logger.error('Failed to get stats:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Create webhook endpoint
app.post('/setup-webhook', async (req, res) => {
    try {
        if (!config.helius.webhookUrl) {
            return res.status(400).json({
                success: false,
                error: 'WEBHOOK_URL not configured'
            });
        }

        const result = await helius.setupWebhook();
        
        logger.info('Webhook setup completed:', result);
        res.json({
            success: true,
            message: 'Webhook created successfully',
            webhook: result
        });
    } catch (error: any) {
        logger.error('Webhook setup failed:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Delete webhook endpoint (useful for cleanup)
app.delete('/webhook/:webhookId', async (req, res) => {
    try {
        const { webhookId } = req.params;
        
        // Note: You'd need to implement deleteWebhook in helius service
        // For now, just return the webhook ID
        res.json({
            success: true,
            message: `Webhook ${webhookId} deletion requested`,
            note: 'Use Helius dashboard to delete webhooks'
        });
    } catch (error: any) {
        logger.error('Webhook deletion failed:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Simulate transaction for testing
app.post('/simulate', async (req, res) => {
    if (config.server.environment === 'production') {
        return res.status(403).json({
            success: false,
            error: 'Simulation not allowed in production'
        });
    }

    try {
        const mockTransaction = {
            signature: 'mock_' + Date.now(),
            timestamp: Math.floor(Date.now() / 1000),
            feePayer: 'MockBuyer123...',
            events: {
                swap: [{
                    tokenInputs: [{
                        mint: 'So11111111111111111111111111111111111111112',
                        tokenAmount: req.body.solAmount || 1000000000 // 1 SOL in lamports
                    }],
                    tokenOutputs: [{
                        mint: config.token.mintAddress,
                        tokenAmount: (req.body.tokenAmount || 1000000) * Math.pow(10, config.token.decimals)
                    }]
                }]
            },
            instructions: [{
                programId: '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8' // Raydium
            }]
        };

        const processed = await botService.processTransaction(mockTransaction);
        
        res.json({
            success: true,
            message: 'Mock transaction processed',
            processed: processed,
            transaction: mockTransaction.signature
        });
    } catch (error: any) {
        logger.error('Transaction simulation failed:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Metrics endpoint (Prometheus format)
app.get('/metrics', (req, res) => {
    try {
        const status = botService.getStatus();
        const stats = telegram.getStats();
        const memory = process.memoryUsage();

        const metrics = `
# HELP bot_processed_transactions_total Total processed transactions
# TYPE bot_processed_transactions_total counter
bot_processed_transactions_total ${status.stats?.transactionCount || 0}

# HELP bot_total_raised_sol Total SOL raised
# TYPE bot_total_raised_sol gauge  
bot_total_raised_sol ${stats.totalRaised || 0}

# HELP bot_total_holders Total token holders
# TYPE bot_total_holders gauge
bot_total_holders ${stats.totalHolders || 0}

# HELP bot_cache_size Current cache size
# TYPE bot_cache_size gauge
bot_cache_size ${status.processedTransactions || 0}

# HELP bot_memory_usage_bytes Memory usage in bytes
# TYPE bot_memory_usage_bytes gauge
bot_memory_usage_bytes{type="rss"} ${memory.rss}
bot_memory_usage_bytes{type="heapUsed"} ${memory.heapUsed}
bot_memory_usage_bytes{type="heapTotal"} ${memory.heapTotal}

# HELP bot_uptime_seconds Bot uptime in seconds
# TYPE bot_uptime_seconds gauge
bot_uptime_seconds ${process.uptime()}
        `.trim();

        res.set('Content-Type', 'text/plain');
        res.send(metrics);
    } catch (error: any) {
        logger.error('Metrics generation failed:', error);
        res.status(500).send('# Metrics generation failed');
    }
});

// Generic error handler
app.use((error: any, req: Request, res: Response, next: NextFunction) => {
    logger.error(`Unhandled error: ${error.message} at ${req.url} (${req.method})\n${error.stack}`);

    res.status(500).json({
        success: false,
        error: 'Internal server error',
        message: config.server.environment === 'development' ? error.message : 'Something went wrong'
    });
});


app.use((req: Request, res: Response) => {
  res.status(404).json({
    success: false,
    error: 'Endpoint not found',
    path: req.path,
    availableEndpoints: [
      'GET /health',
      'GET /stats', 
      'GET /webhooks',
      'GET /test',
      'GET /metrics',
      'POST /webhook',
      'POST /setup-webhook',
      'POST /simulate (dev only)'
    ]
  });
});


// Start server function
async function start() {
    try {
        console.log('🔧 SERVER: Entering start() function');
        
        console.log('🔧 SERVER: Importing config...');
        // Add try-catch around config import in case that's failing
        let configCheck;
        try {
            configCheck = config;
            console.log('✅ SERVER: Config imported successfully');
            console.log('   Port:', configCheck.server?.port);
            console.log('   Environment:', configCheck.server?.environment);
            console.log('   Token:', configCheck.token?.symbol);
        } catch (configError: any) {
            console.error('❌ SERVER: Config import failed:', configError.message);
            throw configError;
        }
        
        console.log('🔧 SERVER: Starting botService initialization...');
        logger.info('Initializing server...');
        
        // Check if botService exists and is importable
        try {
            console.log('🔧 SERVER: Checking botService...');
            const statusCheck = botService.getStatus();
            console.log('✅ SERVER: botService is accessible, status:', statusCheck);
        } catch (botError: any) {
            console.error('❌ SERVER: botService check failed:', botError.message);
            throw new Error(`botService not accessible: ${botError.message}`);
        }
        
        // Add initialization timeout
        const initTimeout = new Promise((_, reject) => {
            setTimeout(() => {
                console.error('⏱️ SERVER: Bot initialization timeout after 30 seconds');
                reject(new Error('Bot initialization timeout after 30 seconds'));
            }, 30000);
        });
        
        console.log('🔧 SERVER: Calling botService.initialize() with timeout...');
        
        try {
            await Promise.race([
                botService.initialize(),
                initTimeout
            ]);
            console.log('✅ SERVER: botService.initialize() completed successfully');
        } catch (initError: any) {
            console.error('❌ SERVER: botService.initialize() failed:', initError.message);
            console.error('Stack:', initError.stack);
            throw initError;
        }
        
        logger.info('✅ Bot service initialized successfully');
        
        console.log('🔧 SERVER: Starting Express server...');
        console.log(`   Port: ${configCheck.server.port} (type: ${typeof configCheck.server.port})`);
        console.log(`   Host: 0.0.0.0`);
        
        // Start HTTP server with detailed logging
        const server = await new Promise<any>((resolve, reject) => {
            console.log('🔧 SERVER: Calling app.listen()...');
            
            const serverInstance = app.listen(configCheck.server.port, '0.0.0.0', () => {
                console.log('✅ SERVER: app.listen() callback executed');
                console.log(`✅ Server running on port ${configCheck.server.port}`);
                console.log(`   Environment: ${configCheck.server.environment}`);
                console.log(`   Webhook URL: ${configCheck.helius.webhookUrl || 'Not configured'}`);
                console.log(`   Polling enabled: ${configCheck.features.enablePolling}`);
                console.log(`   Token symbol: ${configCheck.token.symbol}`);
                console.log(`   Process ID: ${process.pid}`);
                
                logger.info(`✅ Server running on port ${configCheck.server.port}`);
                resolve(serverInstance);
            });

            // Handle server errors
            serverInstance.on('error', (error: any) => {
                console.error('❌ SERVER: Express server error:', error.message);
                console.error('   Code:', error.code);
                console.error('   Port:', configCheck.server.port);
                
                logger.error('Server error:\n' + JSON.stringify({
                    message: error.message,
                    code: error.code,
                    port: configCheck.server.port
                }, null, 2));

                if (error.code === 'EADDRINUSE') {
                    console.error(`❌ Port ${configCheck.server.port} is already in use`);
                } else if (error.code === 'EACCES') {
                    console.error(`❌ Permission denied to bind to port ${configCheck.server.port}`);
                }
                
                reject(error);
            });

            // Add timeout for server startup
            setTimeout(() => {
                console.error('⏱️ SERVER: Express server start timeout');
                reject(new Error('Express server failed to start within timeout'));
            }, 10000);
        });

        console.log('✅ SERVER: Express server started successfully');

        // Set server timeout
        server.timeout = 30000;

        // Graceful shutdown handlers
        const gracefulShutdown = (signal: string) => {
            console.log(`🔄 SERVER: ${signal} received, shutting down gracefully...`);
            logger.info(`${signal} received, shutting down gracefully...`);
            
            server.close((err: any) => {
                if (err) {
                    console.error('❌ SERVER: Error during server shutdown:', err);
                    logger.error('Error during server shutdown:', err);
                }
                
                try {
                    botService.stopPolling();
                    console.log('✅ SERVER: Bot service stopped');
                    logger.info('Bot service stopped');
                } catch (error: any) {
                    console.error('❌ SERVER: Error stopping bot service:', error);
                    logger.error('Error stopping bot service:', error);
                }
                
                console.log('✅ SERVER: Graceful shutdown completed');
                logger.info('Graceful shutdown completed');
                process.exit(0);
            });
            
            // Force exit after timeout
            setTimeout(() => {
                console.error('⏱️ SERVER: Forced shutdown after timeout');
                logger.error('Forced shutdown after timeout');
                process.exit(1);
            }, 10000);
        };

        process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
        process.on('SIGINT', () => gracefulShutdown('SIGINT'));

        console.log('✅ SERVER: start() function completed successfully');
        return server;
        
    } catch (error: any) {
        console.error('❌ SERVER: start() function failed');
        console.error('   Error message:', error.message);
        console.error('   Error name:', error.name);
        console.error('   Error code:', error.code);
        console.error('   Error stack:', error.stack);
        
        logger.error('❌ Failed to start server:\n' + JSON.stringify({
            message: error.message,
            stack: error.stack,
            code: error.code,
            name: error.name
        }, null, 2));
        
        throw error;
    }
}

export default {
    app,
    start
};