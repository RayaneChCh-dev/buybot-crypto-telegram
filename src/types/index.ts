interface TelegramConfig {
  botToken: string;
  channelId: string;
  errorChannelId?: string | undefined;
  retryAttempts: number;
  retryDelay: number;
}

interface HeliusConfig {
  apiKey: string;
  rpcUrl: string;
  webhookUrl?: string | undefined;
  retryAttempts: number;
}

interface TokenConfig {
  mintAddress: string;
  symbol: string;
  decimals: number;
}

interface ServerConfig {
  port: number;
  environment: string;
}

interface FeaturesConfig {
  enablePolling: boolean;
  pollingInterval: number;
  whaleThreshold: number;
  batchWindow: number;
  maxCacheSize: number;
  maxRequestsPerMinute: number;
}

interface Config {
  telegram: TelegramConfig;
  helius: HeliusConfig;
  token: TokenConfig;
  server: ServerConfig;
  features: FeaturesConfig;
}

export type { 
  Config, 
  TelegramConfig, 
  HeliusConfig, 
  TokenConfig, 
  ServerConfig, 
  FeaturesConfig 
};