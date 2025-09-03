import 'dotenv/config';
import { Config } from '../types';

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
    port: parseInt(process.env.PORT || '3000', 10),
    environment: process.env.NODE_ENV || 'development',
  },
  features: {
    // FIX: Disable polling when webhook is configured
    enablePolling: process.env.WEBHOOK_URL ? false : (process.env.ENABLE_POLLING === 'true'),
    // FIX: Increase polling interval to avoid rate limits
    pollingInterval: parseInt(process.env.POLLING_INTERVAL || '30000', 10), // 30 seconds instead of 5
    whaleThreshold: parseFloat(process.env.WHALE_THRESHOLD || '10.0'),
    batchWindow: parseInt(process.env.BATCH_WINDOW || '0', 10),
    maxCacheSize: 1000,
    // ADD: Rate limiting configuration
    maxRequestsPerMinute: parseInt(process.env.MAX_REQUESTS_PER_MINUTE || '50', 10),
  },
};

const required: Array<{key: string, path: string}> = [
  { key: 'TELEGRAM_BOT_TOKEN', path: 'telegram.botToken' },
  { key: 'TELEGRAM_CHANNEL_ID', path: 'telegram.channelId' },
  { key: 'HELIUS_API_KEY', path: 'helius.apiKey' },
  { key: 'TOKEN_MINT_ADDRESS', path: 'token.mintAddress' },
];

for (const { key, path } of required) {
  const value = path.split('.').reduce((obj, k) => (obj as any)?.[k], config);
  if (!value) {
    throw new Error(`Missing required config: ${key}`);
  }
}

if (isNaN(config.token.decimals)) {
  throw new Error('TOKEN_DECIMALS must be a valid number');
}

// Log the mode we're operating in
if (config.helius.webhookUrl && !config.features.enablePolling) {
  console.log('   Mode: Webhook-only (recommended for production)');
} else if (config.features.enablePolling) {
  console.log(`   Mode: Polling every ${config.features.pollingInterval}ms`);
} else {
  console.warn('   Mode: Neither webhook nor polling enabled!');
}

export default config;