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
    // FIX 1: Ensure port is a number, not string
    port: parseInt(process.env.PORT || '3000', 10),
    environment: process.env.NODE_ENV || 'development',
  },
  features: {
    enablePolling: process.env.ENABLE_POLLING === 'true',
    pollingInterval: parseInt(process.env.POLLING_INTERVAL || '5000', 10),
    whaleThreshold: parseFloat(process.env.WHALE_THRESHOLD || '10.0'),
    batchWindow: parseInt(process.env.BATCH_WINDOW || '0', 10),
    maxCacheSize: 1000,
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

if (config.server.port !== undefined) {
  console.log(`   Port: ${config.server.port}`);
} else {
  console.log(`   Port: not set`);
}
export default config;