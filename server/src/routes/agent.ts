import { Router } from 'express'
import OpenAI from 'openai'
import { env } from '../config/env.js'

export const agentRouter = Router()

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

agentRouter.post('/', async (request, response) => {
  if (!env.OPENAI_API_KEY) {
    response.status(500).json({ error: 'OPENAI_API_KEY is missing from server environment' })
    return
  }

  try {
    const body = request.body as {
      message?: string
      history?: { role: 'user' | 'assistant'; content: string }[]
      context?: unknown
    }

    const message = body.message?.trim()
    if (!message) {
      response.status(400).json({ error: 'Message is required' })
      return
    }

    const client = new OpenAI({ apiKey: env.OPENAI_API_KEY })
    const history = (body.history ?? [])
      .slice(-8)
      .map((item) => `${item.role === 'user' ? 'משתמש' : 'סוכן'}: ${item.content}`)
      .join('\n')

    const aiResponse = await client.responses.create({
      model: env.OPENAI_MODEL,
      instructions:
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
        'אם חסר פרט שבאמת אי אפשר להשלים, שאל שאלה ואל תחזיר action.',
      input: [
        `הקשר מהאתר:\n${JSON.stringify(body.context ?? {}, null, 2)}`,
        history ? `שיחה קודמת:\n${history}` : '',
        `משתמש: ${message}`,
      ]
        .filter(Boolean)
        .join('\n\n'),
    })
    const agentOutput = parseAgentOutput(aiResponse.output_text)

    response.json({
      reply: agentOutput.reply || aiResponse.output_text,
      action: agentOutput.action ?? null,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'AI request failed'
    response.status(500).json({ error: message })
  }
})
