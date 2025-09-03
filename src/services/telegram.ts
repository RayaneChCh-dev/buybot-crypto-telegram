import TelegramBot from 'node-telegram-bot-api';
import config from '../config';
import logger from '../utils/logger';
import priceService from './priceService';
import TransactionParser from './parser';
import  withRetry  from '../utils/retry';

class TelegramService {
    bot: TelegramBot;
    stats: {
        totalRaised: number;
        totalHolders: number;
        transactionCount: number;
    };
    constructor() {
        this.bot = new TelegramBot(config.telegram.botToken);
        this.stats = {
            totalRaised: 0,
            totalHolders: 0,
            transactionCount: 0
        };
    }

    async sendTradeNotification(tradeData: any, tokenMetrics: Partial<{ totalHolders: number }> = {}) {
        try {
            await withRetry(async () => {
                // Update stats
                this.stats.totalRaised += tradeData.amountSol;
                this.stats.totalHolders = tokenMetrics.totalHolders || this.stats.totalHolders;
                this.stats.transactionCount++;

                const solPrice = await priceService.getSolPrice();
                const usdValue = tradeData.amountSol * solPrice;
                
                // Choose emoji based on buy size
                let emoji = '🟢';
                if (tradeData.isWhale) emoji = '🐋';
                else if (tradeData.amountSol >= 1) emoji = '🚀';
                else if (tradeData.amountSol >= 0.1) emoji = '💎';

                const actionLabel = tradeData.type === 'BUY' ? 'PURCHASE' : tradeData.type === 'SELL' ? 'SALE' : 'TRADE';


                const message = `
${emoji} **NEW ${config.token.symbol} ${actionLabel}${tradeData.isWhale ? ' - WHALE ALERT!' : ''}**


💰 **Amount**: ${tradeData.amountSol.toFixed(4)} SOL ${solPrice > 0 ? `($${TransactionParser.formatNumber(usdValue)})` : ''}
🪙 **Tokens**: ${TransactionParser.formatNumber(tradeData.tokensBought)} ${config.token.symbol}
💵 **Price**: $${tradeData.pricePerToken.toFixed(8)}
📊 **Total Raised**: ${TransactionParser.formatNumber(this.stats.totalRaised)} SOL
👥 **Holders**: ${TransactionParser.formatNumber(this.stats.totalHolders)}
🔄 **DEX**: ${tradeData.dex}
⏰ **Time**: ${tradeData.timestamp.toLocaleTimeString()}

🔗 [View Transaction](https://solscan.io/tx/${tradeData.signature})
${tradeData.isWhale ? '\n🚨 **WHALE ALERT** 🚨' : ''}
                `.trim();

                await this.bot.sendMessage(config.telegram.channelId, message, {
                    parse_mode: 'Markdown',
                    disable_web_page_preview: true
                });

                logger.info(`Notification sent for ${tradeData.signature} (${tradeData.amountSol} SOL)`);
            }, config.telegram.retryAttempts, config.telegram.retryDelay, 'Send notification');

        } catch (error: any) {
            logger.error('Failed to send notification after retries:', error);
            await this.sendErrorAlert(`Failed to send trade notification: ${error.message}`);
        }
    }

    async sendErrorAlert(errorMessage: string) {
        if (!config.telegram.errorChannelId) return;
        
        try {
            await this.bot.sendMessage(config.telegram.errorChannelId, 
                `🚨 **Bot Error**\n\n${errorMessage}\n\nTime: ${new Date().toISOString()}`,
                { parse_mode: 'Markdown' }
            );
        } catch (error: any) {
            logger.error('Failed to send error alert:', error);
        }
    }

    async sendStartupMessage() {
        try {
            const message = `🤖 **${config.token.symbol} Bot Started**\n\nMonitoring for new purchases...`;
            await this.bot.sendMessage(config.telegram.channelId, message, { parse_mode: 'Markdown' });
        } catch (error: any) {
            logger.warn('Failed to send startup message:', error);
        }
    }

    getStats() {
        return { ...this.stats };
    }
}

export default new TelegramService();