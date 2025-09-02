import 'dotenv/config';

import { Config } from '../types';
import { parse } from 'path';

const config: Config = {
  telegram: {
    botToken: process.env.TELEGRAM_BOT_TOKEN as string,
    channelId: process.env.TELEGRAM_CHANNEL_ID as string,
    errorChannelId: process.env.TELEGRAM_ERROR_CHANNEL_ID,
    retryAttempts: 3,
    retryDelay: 1000,
  },
  helius: {
    apiKey: process.env.HELIUS_API_KEY as string,
    rpcUrl: `https://rpc.helius.xyz/?api-key=${process.env.HELIUS_API_KEY}`,
    webhookUrl: process.env.WEBHOOK_URL,
    retryAttempts: 3,
  },
  token: {
    mintAddress: process.env.TOKEN_MINT_ADDRESS as string,
    symbol: process.env.TOKEN_SYMBOL || 'TOKEN',
    decimals: parseInt(process.env.TOKEN_DECIMALS || '6', 10),
  },
  server: {
    port: parseInt(process.env.PORT ?? '3000', 10),
    environment: process.env.NODE_ENV ?? 'development',
  },
  features: {
    enablePolling: process.env.ENABLE_POLLING === 'true',
    pollingInterval: parseInt(process.env.POLLING_INTERVAL || '5000', 10),
    whaleThreshold: parseFloat(process.env.WHALE_THRESHOLD || '10.0'),
    batchWindow: parseInt(process.env.BATCH_WINDOW || '0', 10),
    maxCacheSize: 1000,
  },
};

// Validate required config
const required: Array<keyof Config | string> = [
  'telegram.botToken',
  'telegram.channelId',
  'helius.apiKey',
  'token.mintAddress',
];

for (const key of required) {
  const value = key.split('.').reduce((obj, k) => (obj as any)?.[k], config);
  if (!value) {
    throw new Error(`❌ Missing required config: ${key}`);
  }
}

export default config;