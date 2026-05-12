import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/authenticate.js';
import { requireAuth } from '../middleware/require-auth.js';
import { requireApartmentMembership } from '../middleware/require-apartment-membership.js';
import { getApartmentIdFromParams, getResourceIdFromParams } from '../lib/request.js';
import { validateBody } from '../lib/validate.js';
import { createTicket, createTicketComment, deleteTicket, listTicketCommentsByApartmentId, listTicketsByApartmentId, updateTicket, updateTicketStatus } from '../services/ticket-service.js';
const attachmentSchema = z.object({
    id: z.string().optional(),
    name: z.string().min(1),
    type: z.string().min(1),
    size: z.number().nonnegative(),
    url: z.string().min(1),
});
const ticketBodySchema = z.object({
    title: z.string().trim().min(1),
    description: z.string().trim().min(1),
    category: z.enum(['issue', 'request', 'finance', 'other']),
    attachments: z.array(attachmentSchema).optional(),
});
const statusBodySchema = z.object({
    status: z.enum(['open', 'sent_to_landlord', 'in_progress', 'closed', 'cancelled']),
});
const commentBodySchema = z.object({
    text: z.string().trim().min(1),
});
export const ticketsRouter = Router({ mergeParams: true });
ticketsRouter.use(authenticate, requireAuth, requireApartmentMembership);
ticketsRouter.get('/', async (request, response, next) => {
    try {
        const apartmentId = getApartmentIdFromParams(request);
        const [tickets, comments] = await Promise.all([
            listTicketsByApartmentId(apartmentId),
            listTicketCommentsByApartmentId(apartmentId),
        ]);
        response.json({ tickets, comments });
    }
    catch (error) {
        next(error);
    }
});
ticketsRouter.post('/', async (request, response, next) => {
    try {
        const apartmentId = getApartmentIdFromParams(request);
        const body = validateBody(ticketBodySchema, request.body);
        const ticket = await createTicket({
            apartmentId,
            title: body.title,
            description: body.description,
            category: body.category,
            createdByAccountId: request.auth.account.id,
            attachments: body.attachments,
        });
        response.status(201).json({ ticket });
    }
    catch (error) {
        next(error);
    }
});
ticketsRouter.patch('/:ticketId', async (request, response, next) => {
    try {
        const apartmentId = getApartmentIdFromParams(request);
        const ticketId = getResourceIdFromParams(request, 'ticketId');
        const body = validateBody(ticketBodySchema, request.body);
        const ticket = await updateTicket({
            apartmentId,
            ticketId,
            title: body.title,
            description: body.description,
            category: body.category,
            attachments: body.attachments,
        });
        response.json({ ticket });
    }
    catch (error) {
        next(error);
    }
});
ticketsRouter.put('/:ticketId', async (request, response, next) => {
    try {
        const apartmentId = getApartmentIdFromParams(request);
        const ticketId = getResourceIdFromParams(request, 'ticketId');
        const body = validateBody(ticketBodySchema, request.body);
        const ticket = await updateTicket({
            apartmentId,
            ticketId,
            title: body.title,
            description: body.description,
            category: body.category,
            attachments: body.attachments,
        });
        response.json({ ticket });
    }
    catch (error) {
        next(error);
    }
});
ticketsRouter.patch('/:ticketId/status', async (request, response, next) => {
    try {
        const apartmentId = getApartmentIdFromParams(request);
        const ticketId = getResourceIdFromParams(request, 'ticketId');
        const body = validateBody(statusBodySchema, request.body);
        const ticket = await updateTicketStatus({
            apartmentId,
            ticketId,
            status: body.status,
        });
        response.json({ ticket });
    }
    catch (error) {
        next(error);
    }
});
ticketsRouter.post('/:ticketId/comments', async (request, response, next) => {
    try {
        const apartmentId = getApartmentIdFromParams(request);
        const ticketId = getResourceIdFromParams(request, 'ticketId');
        const body = validateBody(commentBodySchema, request.body);
        const comment = await createTicketComment({
            apartmentId,
            ticketId,
            accountId: request.auth.account.id,
            text: body.text,
        });
        response.status(201).json({ comment });
    }
    catch (error) {
        next(error);
    }
});
ticketsRouter.delete('/:ticketId', async (request, response, next) => {
    try {
        const ticketId = getResourceIdFromParams(request, 'ticketId');
        await deleteTicket(ticketId);
        response.status(204).send();
    }
    catch (error) {
        next(error);
    }
});
