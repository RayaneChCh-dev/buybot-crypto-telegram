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
    constructor() {
        this.processedTxCache = new SimpleCache(config.features.maxCacheSize);
        this.batchQueue = new Map();
        this.isPolling = false;
    }

    async initialize() {
        logger.info('Initializing bot service...');
        
        // Setup webhook if URL provided
        if (config.helius.webhookUrl && !config.features.enablePolling) {
            try {
                await helius.setupWebhook();
                logger.info('Webhook setup completed');
            } catch (error: any) {
                logger.error('Webhook setup failed, falling back to polling:', error);
                config.features.enablePolling = true;
            }
        }

        // Start polling if enabled
        if (config.features.enablePolling) {
            this.startPolling();
        }

        // Send startup notification
        await telegram.sendStartupMessage();
        
        logger.info('Bot service initialized successfully');
    }

    async processTransaction(transaction: any) {
        // Check for duplicates
        if (this.processedTxCache.has(transaction.signature)) {
            logger.debug(`Skipping duplicate transaction: ${transaction.signature}`);
            return false;
        }

        const tradeData = TransactionParser.parseHeliusTransaction(transaction);
        if (!tradeData) {
            return false;
        }

        // Mark as processed
        this.processedTxCache.set(transaction.signature, Date.now());

        // Handle batching if enabled
        if (config.features.batchWindow > 0) {
            return this.handleBatchedNotification(tradeData);
        }

        // Send immediate notification
        const tokenMetrics = await helius.getTokenMetrics();
        await telegram.sendTradeNotification(tradeData, tokenMetrics);
        
        logger.info(`Processed transaction: ${tradeData.signature} (${tradeData.amountSol} SOL)`);
        return true;
    }

    async processWebhookData(transactions: any) {
        if (!Array.isArray(transactions)) {
            throw new Error('Invalid webhook payload format');
        }

        let processedCount = 0;
        for (const transaction of transactions) {
            try {
                const processed = await this.processTransaction(transaction);
                if (processed) processedCount++;
            } catch (error: any) {
                logger.error(`Error processing transaction ${transaction.signature}:`, error);
            }
        }

        logger.info(`Processed ${processedCount}/${transactions.length} transactions from webhook`);
        return processedCount;
    }

    startPolling() {
        if (this.isPolling) return;
        
        this.isPolling = true;
        logger.info(`Starting polling every ${config.features.pollingInterval}ms`);

        const poll = async () => {
            try {
                const transactions = await helius.getRecentTransactions(10);
                
                for (const transaction of transactions) {
                    await this.processTransaction(transaction);
                }
                
            } catch (error: any) {
                logger.error('Polling error:', error);
            }
        };

        // Initial poll
        poll();
        
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
        // Batch implementation for high-volume tokens
        const batchKey = Math.floor(Date.now() / (config.features.batchWindow * 1000));
        
        if (!this.batchQueue.has(batchKey)) {
            this.batchQueue.set(batchKey, []);
            
            // Process batch after window
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
        // Send summary of batched transactions
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
            stats: telegram.getStats()
        };
    }
}

export default new BotService();