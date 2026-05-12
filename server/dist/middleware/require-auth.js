export function requireAuth(request, response, next) {
    if (!request.auth) {
        response.status(401).json({ error: 'Authentication is required.' });
        return;
    }
    next();
}
