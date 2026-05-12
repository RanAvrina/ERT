import cors from 'cors';
import express from 'express';
import { env } from './config/env.js';
import { errorHandler, notFoundHandler } from './middleware/error-handler.js';
import { apiRouter } from './routes/index.js';
export function createApp() {
    const app = express();
    const allowedOrigins = env.CLIENT_ORIGIN.split(',')
        .map((origin) => origin.trim())
        .filter(Boolean);
    function isAllowedOrigin(origin) {
        if (!origin)
            return true;
        if (allowedOrigins.includes(origin))
            return true;
        return /^https?:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin);
    }
    app.use(cors({
        origin(origin, callback) {
            if (isAllowedOrigin(origin)) {
                callback(null, true);
                return;
            }
            callback(new Error(`Origin ${origin ?? 'unknown'} is not allowed by CORS.`));
        },
        credentials: true,
    }));
    app.use(express.json({ limit: '10mb' }));
    app.get('/', (_request, response) => {
        response.json({
            ok: true,
            service: 'ert-server',
        });
    });
    app.use('/api', apiRouter);
    app.use(notFoundHandler);
    app.use(errorHandler);
    return app;
}
