export function requireRole(allowedRoles) {
    return function roleGuard(request, response, next) {
        const role = request.auth?.membership?.role;
        if (!role) {
            response.status(403).json({ error: 'No active apartment role was found.' });
            return;
        }
        if (!allowedRoles.includes(role)) {
            response.status(403).json({ error: 'You do not have permission for this action.' });
            return;
        }
        next();
    };
}
