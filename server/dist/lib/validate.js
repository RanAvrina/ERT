import { ApiError } from './api-error.js';
export function validateBody(schema, input) {
    const result = schema.safeParse(input);
    if (!result.success) {
        const issue = result.error.issues[0];
        throw new ApiError(400, issue?.message ?? 'Invalid request body.');
    }
    return result.data;
}
