import pino from 'pino';
import config from '../config/index.js';

const logger = pino({
    level: config.server.environment === 'production' ? 'info' : 'debug',
    transport: config.server.environment === 'development' ? {
        target: 'pino-pretty',
        options: {
            colorize: true,
            translateTime: 'SYS:standard',
            ignore: 'pid,hostname'
        }
    } : {
        target: 'pino',
        options: {}
    },
    redact: {
        paths: ['*.apiKey', '*.botToken', '*.token'],
        censor: '***REDACTED***'
    }
});

export default logger;