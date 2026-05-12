import { Router } from 'express';
import { authenticate } from '../middleware/authenticate.js';
import { requireAuth } from '../middleware/require-auth.js';
import { acceptInvite, requireActiveInviteByToken } from '../services/invite-service.js';
import { ApiError } from '../lib/api-error.js';
export const invitesRouter = Router();
invitesRouter.get('/:token', async (request, response, next) => {
    try {
        const token = String(request.params.token ?? '').trim();
        if (!token)
            throw new ApiError(400, 'Invite token is required.');
        const invite = await requireActiveInviteByToken(token);
        response.json({ invite });
    }
    catch (error) {
        next(error);
    }
});
invitesRouter.post('/:token/accept', authenticate, requireAuth, async (request, response, next) => {
    try {
        const token = String(request.params.token ?? '').trim();
        if (!token)
            throw new ApiError(400, 'Invite token is required.');
        const result = await acceptInvite(token, request.auth.account.id);
        response.json(result);
    }
    catch (error) {
        next(error);
    }
});
