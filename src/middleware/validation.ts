import rateLimit from 'express-rate-limit';
import logger from '../utils/logger';

import { Request, Response, NextFunction } from 'express';

const webhookLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 100,
    message: { error: 'Too many webhook requests' },
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => {
        logger.warn(`Rate limit exceeded for ${req.ip}`);
        res.status(429).json({ error: 'Too many requests' });
    }
});

function validateWebhookSource(req: Request, res: Response, next: NextFunction) {
    logger.debug(`Webhook request from ${req.ip}`);
    next();
}
function validateWebhookPayload(req: Request, res: Response, next: NextFunction) {
    if (!Array.isArray(req.body)) {
        logger.warn('Invalid webhook payload format');
        return res.status(400).json({ error: 'Invalid payload format' });
    }
    next();
}

export { webhookLimiter, validateWebhookSource, validateWebhookPayload };
