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
        // Initialize bot service
        await botService.initialize();
        
        // Start HTTP server
        const server = app.listen(config.server.port, () => {
            logger.info(`Server running on port ${config.server.port}. Environment: ${config.server.environment}, Webhook URL: ${config.helius.webhookUrl || 'Not configured'}, Polling enabled: ${config.features.enablePolling}, Token symbol: ${config.token.symbol}`);
        });

        // Graceful shutdown
        process.on('SIGTERM', () => {
            logger.info('SIGTERM received, shutting down gracefully');
            server.close(() => {
                botService.stopPolling();
                process.exit(0);
            });
        });

        process.on('SIGINT', () => {
            logger.info('SIGINT received, shutting down gracefully');
            server.close(() => {
                botService.stopPolling();
                process.exit(0);
            });
        });

        return server;
    } catch (error: any) {
        logger.error('Failed to start server:', error);
        throw error;
    }
}

export default {
    app,
    start
};