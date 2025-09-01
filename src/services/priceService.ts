import axios from 'axios';
import logger from '../utils/logger';
import  withRetry  from '../utils/retry';

class PriceService {
    solPrice: number;
    lastUpdate: number;
    updateInterval: number;
    constructor() {
        this.solPrice = 0;
        this.lastUpdate = 0;
        this.updateInterval = 60000; // 1 minute
    }

    async getSolPrice() {
        const now = Date.now();
        if (now - this.lastUpdate > this.updateInterval) {
            await this.updatePrice();
        }
        return this.solPrice;
    }

    async updatePrice() {
        try {
            await withRetry(async () => {
                // Try Jupiter first, fallback to CoinGecko
                try {
                    const response = await axios.get(
                        'https://price.jup.ag/v4/price?ids=So11111111111111111111111111111111111111112',
                        { timeout: 5000 }
                    );
                    this.solPrice = response.data.data?.So11111111111111111111111111111111111111112?.price || 0;
                } catch {
                    // Fallback to CoinGecko
                    const response = await axios.get(
                        'https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd',
                        { timeout: 5000 }
                    );
                    this.solPrice = response.data.solana?.usd || 0;
                }
                
                this.lastUpdate = Date.now();
                logger.debug(`SOL price updated: $${this.solPrice}`);
            }, 2, 1000, 'Price fetch');
        } catch (error) {
            logger.error('Failed to update SOL price:', error);
        }
    }
}

export default new PriceService();