import { Router } from 'express'
import OpenAI from 'openai'
import { z } from 'zod'
import { env } from '../config/env.js'
import { authenticate } from '../middleware/authenticate.js'
import { requireAuth } from '../middleware/require-auth.js'
import { createRateLimit } from '../middleware/rate-limit.js'
import { validateBody } from '../lib/validate.js'
import { ApiError } from '../lib/api-error.js'
import {
  createPendingAgentAction,
  confirmPendingAgentAction,
  validateAgentAction,
} from '../services/agent-action-service.js'
import { buildAgentContext } from '../services/agent-context-service.js'
import {
  clearPendingAgentFollowUp,
  getPendingAgentFollowUp,
  storePendingAgentFollowUp,
} from '../services/agent-followup-service.js'

export const agentRouter = Router()

const queryBodySchema = z.object({
  message: z.string().trim().min(1),
  history: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string().trim().min(1),
      }),
    )
    .max(8)
    .optional(),
})

const confirmBodySchema = z.object({
  token: z.string().trim().min(1),
})

type AgentContext = Awaited<ReturnType<typeof buildAgentContext>>

const HE = {
  whoOwesMe: 'מי חייב לי',
  whoElseOwesMe: 'מי עוד חייב לי',
  howMuchOweMe: 'כמה כסף חייבים לי',
  howMuchNameOwesMe: 'כמה',
  owe: 'חייב',
  owePlural: 'חייבים',
  toMe: 'לי',
  toWhomDoIOwe: 'למי אני חייב',
  whyDoIOwe: 'למה אני חייב',
  howMuchDoIOwe: 'כמה אני חייב',
  i: 'אני',
  nobodyOwesMe: 'לפי החישוב במערכת, כרגע אף אחד לא חייב לך כסף.',
  youOweNobody: 'לפי החישוב במערכת, כרגע אינך חייב כסף לאף אחד.',
  whatUrgent: 'מה הכי דחוף',
  whatNeedsBuying: 'מה צריך לקנות',
  whatMissingToBuy: 'מה חסר לקנות',
  overdueTasks: 'מטלות באיחור',
  anyOverdueTasks: 'יש מטלות באיחור',
} as const

function parseAgentOutput(output: string) {
  try {
    return JSON.parse(output) as {
      reply?: string
      action?: unknown
    }
  } catch {
    const jsonMatch = output.match(/\{[\s\S]*\}/)
    if (!jsonMatch) return { reply: output }

    try {
      return JSON.parse(jsonMatch[0]) as {
        reply?: string
        action?: unknown
      }
    } catch {
      return { reply: output }
    }
  }
}

async function callAgentWithRetry(
  client: OpenAI,
  systemPrompt: string,
  userInput: string,
  maxRetries: number = 3,
) {
  let lastError: Error | null = null

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 30000) // 30 second timeout

      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${env.OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
          model: env.OPENAI_MODEL,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userInput },
          ],
          temperature: 0.7,
          max_tokens: 800,
        }),
        signal: controller.signal,
      })

      clearTimeout(timeoutId)

      if (!response.ok) {
        const errorData = (await response.json()) as { error?: { message: string } }
        throw new Error(
          `OpenAI API error (${response.status}): ${errorData.error?.message || response.statusText}`,
        )
      }

      const data = (await response.json()) as { choices: { message: { content: string } }[] }
      return data.choices[0]?.message.content || ''
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))
      console.error(`[agent-retry] Attempt ${attempt}/${maxRetries} failed:`, lastError.message)

      if (attempt < maxRetries) {
        const delayMs = Math.min(1000 * Math.pow(2, attempt - 1), 8000)
        await new Promise((resolve) => setTimeout(resolve, delayMs))
      }
    }
  }

  throw lastError || new Error('Agent request failed after retries')
}

agentRouter.post('/', async (request, response) => {
  if (!env.OPENAI_API_KEY) {
    response.status(500).json({ error: 'OPENAI_API_KEY is missing from server environment' })
    return
  }

  try {
    const body = validateBody(queryBodySchema, request.body)
    const apartmentId = requireActiveApartment(request)
    const accountId = request.auth!.account.id
    const context = await buildAgentContext(apartmentId, accountId)
    const deterministicDebtReply = getDeterministicDebtReply(body.message, context)
    const deterministicOperationsReply = getDeterministicOperationsReply(body.message, context)
    const pendingFollowUp = getPendingAgentFollowUp(accountId, apartmentId)

    if (deterministicDebtReply) {
      clearPendingAgentFollowUp(accountId, apartmentId)
      response.json({
        reply: deterministicDebtReply,
        pendingAction: null,
      })
      return
    }

    if (deterministicOperationsReply) {
      clearPendingAgentFollowUp(accountId, apartmentId)
      response.json({
        reply: deterministicOperationsReply,
        pendingAction: null,
      })
      return
    }

    const history = (body.history ?? [])
      .slice(-6)
      .map((item) => `${item.role === 'user' ? 'משתמש' : 'סוכן'}: ${item.content}`)
      .join('\n')
    const openAIContext = buildScopedOpenAIContext(
      context,
      body.message,
      pendingFollowUp?.originalMessage,
    )

    const systemPrompt =
      'אתה סוכן AI בתוך מערכת ERT לניהול דירת שותפים. ענה בעברית קצרה וברורה. ' +
      'השתמש רק בהקשר שהאתר שולח לך. אל תטען שביצעת פעולה בפועל. ' +
      'כאשר המשתמש מבקש שינוי באתר, החזר פעולה מובנית לאישור המשתמש. ' +
      'החזר תמיד JSON תקין בלבד בפורמט: {"reply":"טקסט למשתמש","action":null או אובייקט}. ' +
      'פעולות מותרות: ' +
      'create_task {title, taskType, targetItemName, description, assigneeName, dueDate}; ' +
      'update_task_due_date {taskId, taskTitle, dueDate}; ' +
      'update_task_status {taskId, taskTitle, status}; ' +
      'create_expense {description, amount, category, date, paidByName}; ' +
      'create_shopping_item {itemName, quantity, category}; ' +
      'create_ticket {title, description, category}. ' +
      'status מותר: open, in_progress, done, cancelled. ' +
      'taskType מותר: cleaning, maintenance, shopping, inspection, other. ' +
      'category לפנייה מותר: issue, request, finance, other. ' +
      'assigneeName אופציונלי; אם לא צוין אחראי, האתר ישתמש במשתמש הנוכחי. ' +
      'אם המשתמש אומר מחר/שבוע הבא, חשב dueDate לפי context.today והחזר YYYY-MM-DD. ' +
      'אם חסר פרט שבאמת אי אפשר להשלים, שאל שאלה ואל תחזיר action.'

    const userInput = [
      `הקשר מהאתר:\n${JSON.stringify(body.context ?? {}, null, 2)}`,
      history ? `שיחה קודמת:\n${history}` : '',
      `משתמש: ${message}`,
    ]
      .filter(Boolean)
      .join('\n\n')

    const client = new OpenAI({ apiKey: env.OPENAI_API_KEY })
    const aiResponseText = await callAgentWithRetry(client, systemPrompt, userInput)
    const agentOutput = parseAgentOutput(aiResponseText)

    response.json({
      reply: agentOutput.reply || aiResponseText,
      action: agentOutput.action ?? null,
    })
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'AI request failed'
    console.error('[agent-error]', errorMessage)
    response.status(500).json({ error: errorMessage })
  }
})
