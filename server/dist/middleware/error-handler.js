import { ApiError } from '../lib/api-error.js';
export function notFoundHandler(_request, response) {
    response.status(404).json({ error: 'Route not found.' });
}
export function errorHandler(error, _request, response, _next) {
    if (error instanceof ApiError) {
        response.status(error.statusCode).json({ error: error.message });
        return;
    }
    const message = error instanceof Error ? error.message : 'Unexpected server error.';
    response.status(500).json({ error: message });
}
