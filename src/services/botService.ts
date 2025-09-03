import helius from './helius';
import telegram from './telegram';
import TransactionParser from './parser';
import SimpleCache from '../utils/cache';
import config from '../config';
import logger from '../utils/logger';

class BotService {
    processedTxCache: SimpleCache;
    batchQueue: Map<number, any[]>;
    isPolling: boolean;
    pollingInterval: any;
    
    private requestQueue: Array<() => Promise<void>> = [];
    private requestsThisMinute = 0;
    private requestWindowStart = Date.now();
    private isProcessingQueue = false;

    constructor() {
        this.processedTxCache = new SimpleCache(config.features.maxCacheSize);
        this.batchQueue = new Map();
        this.isPolling = false;
        
        setInterval(() => {
            this.requestsThisMinute = 0;
            this.requestWindowStart = Date.now();
            this.processRequestQueue();
        }, 60000);
    }

    async initialize() {
        logger.info('Initializing bot service...');
        
        // EMERGENCY FIX: Don't set up webhook on startup if we have webhook URL
        // Just assume it's already set up or will be set up manually
        if (config.helius.webhookUrl) {
            logger.info('Webhook mode enabled - assuming webhook is already configured');
            logger.info('If webhook needs setup, use POST /setup-webhook endpoint manually');
            
            // Don't fail startup if webhook setup fails
            // this.setupWebhookLater();
            
        } else if (config.features.enablePolling) {
            logger.info('Using polling mode - webhook not configured');
            this.startPolling();
        } else {
            logger.warn('Neither webhook nor polling configured - bot will only process manual webhook calls');
        }
        
        // Send startup message
        try {
            await telegram.sendStartupMessage();
        } catch (error: any) {
            logger.error('Failed to send startup message:', error.message);
            // Don't fail startup for this
        }
        
        logger.info('Bot service initialized successfully');
    }

    // Optional: Try to setup webhook after startup (non-blocking)
    private setupWebhookLater() {
        setTimeout(async () => {
            try {
                logger.info('Attempting delayed webhook setup...');
                await this.queueRequest(() => helius.setupWebhook());
                logger.info('Delayed webhook setup completed successfully');
            } catch (error: any) {
                logger.warn('Delayed webhook setup failed - use /setup-webhook endpoint manually:', error.message);
            }
        }, 30000); // Wait 30 seconds after startup
    }

    private async queueRequest<T>(request: () => Promise<T>): Promise<T> {
        return new Promise((resolve, reject) => {
            this.requestQueue.push(async () => {
                try {
                    const result = await request();
                    resolve(result);
                } catch (error) {
                    reject(error);
                }
            });
            this.processRequestQueue();
        });
    }

    private async processRequestQueue() {
        if (this.isProcessingQueue || this.requestQueue.length === 0) return;
        
        const now = Date.now();
        if (now - this.requestWindowStart > 60000) {
            this.requestsThisMinute = 0;
            this.requestWindowStart = now;
        }
        
        if (this.requestsThisMinute >= config.features.maxRequestsPerMinute) {
            logger.warn(`Rate limit reached (${this.requestsThisMinute}/${config.features.maxRequestsPerMinute}), queuing requests`);
            return;
        }
        
        this.isProcessingQueue = true;
        const request = this.requestQueue.shift();
        
        if (request) {
            this.requestsThisMinute++;
            try {
                await request();
            } catch (error: any) {
                logger.error('Queued request failed:', error);
            }
            
            setTimeout(() => {
                this.isProcessingQueue = false;
                this.processRequestQueue();
            }, 1000); // Increased delay between requests
        } else {
            this.isProcessingQueue = false;
        }
    }

    async processTransaction(transaction: any) {
        if (this.processedTxCache.has(transaction.signature)) {
            logger.debug(`Skipping duplicate transaction: ${transaction.signature}`);
            return false;
        }

        const tradeData = TransactionParser.parseHeliusTransaction(transaction);
        if (!tradeData) {
            return false;
        }
        
        this.processedTxCache.set(transaction.signature, Date.now());
        
        if (config.features.batchWindow > 0) {
            return this.handleBatchedNotification(tradeData);
        }

        // Send notification without token metrics to avoid rate limits
        try {
            await telegram.sendTradeNotification(tradeData, { totalHolders: 0 });
            logger.info(`Processed transaction: ${tradeData.signature} (${tradeData.amountSol} SOL)`);
        } catch (error: any) {
            logger.error('Failed to send trade notification:', error.message);
        }
        
        return true;
    }

    async processWebhookData(transactions: any) {
        if (!Array.isArray(transactions)) {
            throw new Error('Invalid webhook payload format');
        }

        logger.info(`Processing webhook with ${transactions.length} transactions`);
        let processedCount = 0;
        
        // Process transactions sequentially to avoid overwhelming system
        for (const transaction of transactions) {
            try {
                const processed = await this.processTransaction(transaction);
                if (processed) processedCount++;
            } catch (error: any) {
                logger.error(`Error processing transaction ${transaction.signature}:`, error);
            }
            
            // Small delay between transactions
            await new Promise(resolve => setTimeout(resolve, 50));
        }

        logger.info(`Processed ${processedCount}/${transactions.length} transactions from webhook`);
        return processedCount;
    }

    startPolling() {
        if (this.isPolling) {
            logger.warn('Polling already active');
            return;
        }
        
        this.isPolling = true;
        logger.info(`Starting polling every ${config.features.pollingInterval}ms`);

        const poll = async () => {
            if (!this.isPolling) return;
            
            try {
                const transactions = await this.queueRequest(() => 
                    helius.getRecentTransactions(3) // Reduced to 3 transactions
                );
                
                for (const transaction of transactions) {
                    await this.processTransaction(transaction);
                }
                
            } catch (error: any) {
                logger.error('Polling error:', error);
                
                if (error.message?.includes('429') || error.response?.status === 429) {
                    logger.warn('Rate limited during polling, pausing for 2 minutes');
                    this.stopPolling();
                    setTimeout(() => {
                        logger.info('Resuming polling after rate limit pause');
                        this.startPolling();
                    }, 120000); // 2 minute pause
                    return;
                }
            }
        };

        setTimeout(poll, 5000); // Initial delay
        this.pollingInterval = setInterval(poll, config.features.pollingInterval);
    }

    stopPolling() {
        if (this.pollingInterval) {
            clearInterval(this.pollingInterval);
            this.pollingInterval = null;
        }
        this.isPolling = false;
        logger.info('Polling stopped');
    }

    handleBatchedNotification(tradeData: any) {
        const batchKey = Math.floor(Date.now() / (config.features.batchWindow * 1000));
        
        if (!this.batchQueue.has(batchKey)) {
            this.batchQueue.set(batchKey, []);
            
            setTimeout(async () => {
                const batch = this.batchQueue.get(batchKey);
                this.batchQueue.delete(batchKey);
                
                if (batch && batch.length > 0) {
                    await this.processBatch(batch);
                }
            }, config.features.batchWindow * 1000);
        }
        
        this.batchQueue.get(batchKey)?.push(tradeData);
        return true;
    }

    async processBatch(batch: any[]) {
        const totalSol = batch.reduce((sum, trade) => sum + trade.amountSol, 0);
        const totalTokens = batch.reduce((sum, trade) => sum + trade.tokensBought, 0);
        const whaleCount = batch.filter(trade => trade.isWhale).length;

        const message = `
📦 **Batch Summary (${batch.length} transactions)**

💰 **Total Volume**: ${totalSol.toFixed(4)} SOL
🪙 **Total Tokens**: ${TransactionParser.formatNumber(totalTokens)} ${config.token.symbol}
🐋 **Whales**: ${whaleCount}
⏰ **Window**: ${config.features.batchWindow}s

${batch.slice(0, 3).map(trade => 
    `• ${trade.amountSol.toFixed(2)} SOL (${trade.dex})`
).join('\n')}
${batch.length > 3 ? `\n... and ${batch.length - 3} more` : ''}
        `.trim();

        try {
            await telegram.bot.sendMessage(config.telegram.channelId, message, {
                parse_mode: 'Markdown'
            });
        } catch (error: any) {
            logger.error('Failed to send batch notification:', error.message);
        }
    }

    // Add method to manually setup webhook
    async setupWebhookManually() {
        try {
            const result = await helius.setupWebhook();
            logger.info('Manual webhook setup completed:', result);
            return result;
        } catch (error: any) {
            logger.error('Manual webhook setup failed:', error);
            throw error;
        }
    }

    getStatus() {
        return {
            isPolling: this.isPolling,
            processedTransactions: this.processedTxCache.size(),
            batchQueueSize: this.batchQueue.size,
            requestsThisMinute: this.requestsThisMinute,
            queuedRequests: this.requestQueue.length,
            webhookConfigured: !!config.helius.webhookUrl,
            stats: telegram.getStats()
        };
    }
}

export default new BotService();