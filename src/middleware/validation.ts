import rateLimit from 'express-rate-limit';
import config from '../config';
import logger from '../utils/logger.js';

// Rate limiting for webhook endpoint
const webhookLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 100, // Max 100 requests per minute
    message: { error: 'Too many webhook requests' },
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => {
        logger.warn(`Rate limit exceeded for ${req.ip}`);
        res.status(429).json({ error: 'Too many requests' });
    }
});

// Validate webhook source (basic IP validation)
function validateWebhookSource(req, res, next) {
    // Add Helius IP ranges here if they provide them
    // For now, just log the source
    logger.debug(`Webhook request from ${req.ip}`);
    next();
}

// Validate request payload
function validateWebhookPayload(req, res, next) {
    if (!Array.isArray(req.body)) {
        logger.warn('Invalid webhook payload format');
        return res.status(400).json({ error: 'Invalid payload format' });
    }
    next();
}

export { webhookLimiter, validateWebhookSource, validateWebhookPayload };
