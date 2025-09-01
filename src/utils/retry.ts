import logger from '../utils/logger';

async function withRetry(fn, attempts = 3, delay = 1000, context = 'operation') {
    for (let i = 0; i < attempts; i++) {
        try {
            return await fn();
        } catch (error) {
            const isLastAttempt = i === attempts - 1;
            
            if (isLastAttempt) {
                logger.error(`${context} failed after ${attempts} attempts:`, error);
                throw error;
            }
            
            logger.warn(`${context} failed, retrying in ${delay}ms... (${i + 1}/${attempts})`, error.message);
            await new Promise(resolve => setTimeout(resolve, delay * Math.pow(2, i))); // Exponential backoff
        }
    }
}

export default withRetry; 