import logger from '../utils/logger';

async function withRetry<T>(
  fn: () => Promise<T>,
  attempts = 3,
  baseDelay = 1000,
  context = 'operation'
): Promise<T> {
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (error: any) {
      const isLastAttempt = i === attempts - 1;
      
      // Special handling for rate limits
      if (error.response?.status === 429) {
        const retryAfter = error.response?.headers['retry-after'];
        const rateLimitDelay = retryAfter ? parseInt(retryAfter) * 1000 : baseDelay * Math.pow(2, i);
        
        if (isLastAttempt) {
          logger.error(`${context} rate limited after ${attempts} attempts`);
          throw error;
        }
        
        logger.warn(`${context} rate limited, waiting ${rateLimitDelay}ms... (${i + 1}/${attempts})`);
        await new Promise(resolve => setTimeout(resolve, rateLimitDelay));
        continue;
      }
      
      if (isLastAttempt) {
        logger.error(`${context} failed after ${attempts} attempts:`, error);
        throw error;
      }

      const delay = baseDelay * Math.pow(2, i);
      logger.warn(`${context} failed, retrying in ${delay}ms... (${i + 1}/${attempts})`, error.message);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  throw new Error(`${context} failed after ${attempts} attempts`);
}

export default withRetry; 