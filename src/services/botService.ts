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
    
    // ADD: Rate limiting
    private requestQueue: Array<() => Promise<void>> = [];
    private requestsThisMinute = 0;
    private requestWindowStart = Date.now();
    private isProcessingQueue = false;

    constructor() {
        this.processedTxCache = new SimpleCache(config.features.maxCacheSize);
        this.batchQueue = new Map();
        this.isPolling = false;
        
        // Reset rate limit counter every minute
        setInterval(() => {
            this.requestsThisMinute = 0;
            this.requestWindowStart = Date.now();
            this.processRequestQueue();
        }, 60000);
    }

    async initialize() {
        logger.info('Initializing bot service...');
        
        // CRITICAL FIX: Choose ONE method, not both
        if (config.helius.webhookUrl) {
            logger.info('Using webhook mode - polling disabled');
            try {
                await this.queueRequest(() => helius.setupWebhook());
                logger.info('Webhook setup completed');
            } catch (error: any) {
                logger.error('Webhook setup failed:', error);
                throw error; // Don't fall back to polling in production
            }
        } else if (config.features.enablePolling) {
            logger.info('Using polling mode - webhook not configured');
            this.startPolling();
        } else {
            throw new Error('Neither webhook nor polling is configured!');
        }
        
        await telegram.sendStartupMessage();
        logger.info('Bot service initialized successfully');
    }

    // ADD: Request queuing to respect rate limits
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
        
        // Check if we're within rate limits
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
            
            // Small delay between requests
            setTimeout(() => {
                this.isProcessingQueue = false;
                this.processRequestQueue();
            }, 200);
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

        // Queue the token metrics request to avoid rate limits
        try {
            const tokenMetrics = await this.queueRequest(() => helius.getTokenMetrics());
            await telegram.sendTradeNotification(tradeData, tokenMetrics);
        } catch (error: any) {
            logger.error('Failed to get token metrics, sending without:', error.message);
            await telegram.sendTradeNotification(tradeData, { totalHolders: 0 });
        }
        
        logger.info(`Processed transaction: ${tradeData.signature} (${tradeData.amountSol} SOL)`);
        return true;
    }

    async processWebhookData(transactions: any) {
        if (!Array.isArray(transactions)) {
            throw new Error('Invalid webhook payload format');
        }

        logger.info(`Processing webhook with ${transactions.length} transactions`);
        let processedCount = 0;
        
        // Process transactions in smaller batches to avoid overwhelming the system
        const batchSize = 5;
        for (let i = 0; i < transactions.length; i += batchSize) {
            const batch = transactions.slice(i, i + batchSize);
            
            await Promise.allSettled(
                batch.map(async (transaction) => {
                    try {
                        const processed = await this.processTransaction(transaction);
                        if (processed) processedCount++;
                    } catch (error: any) {
                        logger.error(`Error processing transaction ${transaction.signature}:`, error);
                    }
                })
            );
            
            // Small delay between batches
            if (i + batchSize < transactions.length) {
                await new Promise(resolve => setTimeout(resolve, 100));
            }
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
            if (!this.isPolling) return; // Check if still should be polling
            
            try {
                // Use the rate-limited queue for polling requests
                const transactions = await this.queueRequest(() => 
                    helius.getRecentTransactions(5) // Reduced from 10 to 5
                );
                
                for (const transaction of transactions) {
                    await this.processTransaction(transaction);
                }
                
            } catch (error: any) {
                logger.error('Polling error:', error);
                
                // If rate limited, increase polling interval temporarily
                if (error.message?.includes('429') || error.response?.status === 429) {
                    logger.warn('Rate limited during polling, increasing interval');
                    clearInterval(this.pollingInterval);
                    setTimeout(() => {
                        if (this.isPolling) {
                            this.pollingInterval = setInterval(poll, config.features.pollingInterval);
                        }
                    }, 60000); // Wait 1 minute before resuming normal polling
                    return;
                }
            }
        };

        // Initial poll with delay
        setTimeout(poll, 2000);
        
        // Set up interval
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

        await telegram.bot.sendMessage(config.telegram.channelId, message, {
            parse_mode: 'Markdown'
        });
    }

    getStatus() {
        return {
            isPolling: this.isPolling,
            processedTransactions: this.processedTxCache.size(),
            batchQueueSize: this.batchQueue.size,
            requestsThisMinute: this.requestsThisMinute,
            queuedRequests: this.requestQueue.length,
            stats: telegram.getStats()
        };
    }
}

export default new BotService();