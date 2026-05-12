import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/authenticate.js';
import { requireAuth } from '../middleware/require-auth.js';
import { requireApartmentMembership } from '../middleware/require-apartment-membership.js';
import { requireRole } from '../middleware/require-role.js';
import { getApartmentIdFromParams, getResourceIdFromParams } from '../lib/request.js';
import { validateBody } from '../lib/validate.js';
import { createExpense, listExpensesByApartmentId, softDeleteExpense, updateExpense } from '../services/finance-service.js';
const attachmentSchema = z.object({
    id: z.string().optional(),
    name: z.string().min(1),
    type: z.string().min(1),
    size: z.number().nonnegative(),
    url: z.string().min(1),
});
const expenseBodySchema = z.object({
    paidByAccountId: z.number().int().positive(),
    amount: z.string().min(1),
    description: z.string().trim().min(1),
    category: z.string().trim().nullable().optional(),
    date: z.string().min(1),
    participantAccountIds: z.array(z.number().int().positive()).default([]),
    attachments: z.array(attachmentSchema).optional(),
});
export const expensesRouter = Router({ mergeParams: true });
expensesRouter.use(authenticate, requireAuth, requireApartmentMembership, requireRole(['admin', 'tenant']));
expensesRouter.get('/', async (request, response, next) => {
    try {
        const apartmentId = getApartmentIdFromParams(request);
        const expenses = await listExpensesByApartmentId(apartmentId);
        response.json({ expenses });
    }
    catch (error) {
        next(error);
    }
});
expensesRouter.post('/', async (request, response, next) => {
    try {
        const apartmentId = getApartmentIdFromParams(request);
        const body = validateBody(expenseBodySchema, request.body);
        const expense = await createExpense({
            apartmentId,
            ...body,
            category: body.category ?? null,
        });
        response.status(201).json({ expense });
    }
    catch (error) {
        next(error);
    }
});
const updateExpenseHandler = async (request, response, next) => {
    try {
        const apartmentId = getApartmentIdFromParams(request);
        const expenseId = getResourceIdFromParams(request, 'expenseId');
        const body = validateBody(expenseBodySchema, request.body);
        const expense = await updateExpense({
            apartmentId,
            expenseId,
            ...body,
            category: body.category ?? null,
        });
        response.json({ expense });
    }
    catch (error) {
        next(error);
    }
};
expensesRouter.patch('/:expenseId', updateExpenseHandler);
expensesRouter.put('/:expenseId', updateExpenseHandler);
expensesRouter.delete('/:expenseId', async (request, response, next) => {
    try {
        const expenseId = getResourceIdFromParams(request, 'expenseId');
        await softDeleteExpense(expenseId);
        response.status(204).send();
    }
    catch (error) {
        next(error);
    }
});
