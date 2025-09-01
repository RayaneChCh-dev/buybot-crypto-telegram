import axios from 'axios';
import { Connection, PublicKey } from '@solana/web3.js';
import config from '../config';
import logger from '../utils/logger';
import  withRetry  from '../utils/retry';

class HeliusService {
    connection: Connection;
    constructor() {
        this.connection = new Connection(config.helius.rpcUrl);
    }

    async setupWebhook() {
        const webhookConfig = {
            webhookURL: config.helius.webhookUrl,
            transactionTypes: ['SWAP'],
            accountAddresses: [config.token.mintAddress],
            webhookType: 'enhanced'
        };

        return withRetry(async () => {
            const response = await axios.post(
                `https://api.helius.xyz/v0/webhooks?api-key=${config.helius.apiKey}`,
                webhookConfig,
                { timeout: 10000 }
            );
            logger.info('Helius webhook created:', response.data);
            return response.data;
        }, config.helius.retryAttempts, 2000, 'Webhook setup');
    }

    async getWebhooks() {
        return withRetry(async () => {
            const response = await axios.get(
                `https://api.helius.xyz/v0/webhooks?api-key=${config.helius.apiKey}`,
                { timeout: 10000 }
            );
            return response.data;
        }, 2, 1000, 'Get webhooks');
    }

    async getRecentTransactions(limit = 5) {
        return withRetry(async () => {
            const signatures = await this.connection.getSignaturesForAddress(
                new PublicKey(config.token.mintAddress ?? ''),
                { limit }
            );
            
            if (signatures.length === 0) return [];

            const response = await axios.post(
                `https://api.helius.xyz/v0/transactions?api-key=${config.helius.apiKey}`,
                { transactions: signatures.map(s => s.signature) },
                { timeout: 15000 }
            );
            
            return response.data || [];
        }, config.helius.retryAttempts, 2000, 'Fetch transactions');
    }

    async getTokenMetrics() {
        try {
            return withRetry(async () => {
                const response = await axios.get(
                    `https://api.helius.xyz/v0/addresses/${config.token.mintAddress}/balances?api-key=${config.helius.apiKey}`,
                    { timeout: 10000 }
                );
                
                const holders = response.data?.filter(holder => holder.amount > 0)?.length || 0;
                return { totalHolders: holders };
            }, 2, 1000, 'Token metrics');
        } catch (error) {
            logger.warn('Failed to fetch token metrics:', error.message);
            return { totalHolders: 0 };
        }
    }
}

export default new HeliusService();
