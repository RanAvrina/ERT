import { findActiveMembershipByApartmentAndAccount } from '../services/membership-service.js';
export async function requireApartmentMembership(request, response, next) {
    try {
        const apartmentId = Number(request.params.apartmentId);
        if (!request.auth) {
            response.status(401).json({ error: 'Authentication is required.' });
            return;
        }
        if (!Number.isInteger(apartmentId) || apartmentId <= 0) {
            response.status(400).json({ error: 'A valid apartment id is required.' });
            return;
        }
        const membership = await findActiveMembershipByApartmentAndAccount(apartmentId, request.auth.account.id);
        if (!membership) {
            response.status(403).json({ error: 'You do not belong to this apartment.' });
            return;
        }
        request.auth.membership = membership;
        next();
    }
    catch (error) {
        next(error);
    }
}
