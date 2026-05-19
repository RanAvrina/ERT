import { env } from '../config/env.js'

export interface OpenAiMessageInput {
  role: 'user' | 'assistant'
  text: string
}

export interface OpenAiFunctionToolDefinition {
  type: 'function'
  name: string
  description: string
  parameters: Record<string, unknown>
}

export interface OpenAiFunctionToolResult<TSideEffect = null> {
  output: Record<string, unknown>
  sideEffect?: TSideEffect | null
}

interface ResponsesOutputTextItem {
  type: 'output_text'
  text: string
}

interface ResponsesMessageOutputItem {
  type: 'message'
  content?: ResponsesOutputTextItem[]
}

interface ResponsesFunctionCallOutputItem {
  type: 'function_call'
  name: string
  arguments: string
  call_id: string
}

interface ResponsesApiResponse {
  id: string
  output?: Array<ResponsesMessageOutputItem | ResponsesFunctionCallOutputItem | { type: string }>
}

type ResponsesOutputItem = NonNullable<ResponsesApiResponse['output']>[number]

function isResponsesMessageItem(
  item: ResponsesOutputItem,
): item is ResponsesMessageOutputItem {
  return item?.type === 'message'
}

function isResponsesFunctionCallItem(
  item: ResponsesOutputItem,
): item is ResponsesFunctionCallOutputItem {
  return item?.type === 'function_call'
}

function extractResponseText(response: ResponsesApiResponse) {
  return (response.output ?? [])
    .filter(isResponsesMessageItem)
    .flatMap((item) => item.content ?? [])
    .filter((item) => item.type === 'output_text')
    .map((item) => item.text.trim())
    .filter(Boolean)
    .join('\n')
    .trim()
}

async function createResponsesRequest(input: Record<string, unknown>) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 12_000)

  try {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify(input),
      signal: controller.signal,
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`OpenAI Responses API failed (${response.status}): ${errorText}`)
    }

    return (await response.json()) as ResponsesApiResponse
  } finally {
    clearTimeout(timeout)
  }
}

export function isOpenAiResponsesEnabled() {
  return Boolean(env.OPENAI_ASSISTANT_ENABLED && env.OPENAI_API_KEY)
}

export async function runOpenAiToolLoop<TSideEffect = null>(input: {
  systemPrompt: string
  userPrompt: string
  history?: OpenAiMessageInput[]
  tools: OpenAiFunctionToolDefinition[]
  onToolCall: (
    name: string,
    args: Record<string, unknown>,
  ) => Promise<OpenAiFunctionToolResult<TSideEffect>> | OpenAiFunctionToolResult<TSideEffect>
}) {
  let response = await createResponsesRequest({
    model: env.OPENAI_MODEL,
    instructions: input.systemPrompt,
    max_output_tokens: 220,
    text: {
      format: { type: 'text' },
    },
    input: [
      ...(input.history ?? []).map((message) => ({
        role: message.role,
        content: message.text,
      })),
      {
        role: 'user',
        content: input.userPrompt,
      },
    ],
    tools: input.tools,
    tool_choice: 'auto',
  })

  let sideEffect: TSideEffect | null = null

  for (let iteration = 0; iteration < 4; iteration += 1) {
    const functionCalls = (response.output ?? []).filter(isResponsesFunctionCallItem)
    if (!functionCalls.length) {
      return {
        text: extractResponseText(response),
        sideEffect,
      }
    }

    const toolOutputs = []

    for (const functionCall of functionCalls) {
      const parsedArguments = functionCall.arguments ? JSON.parse(functionCall.arguments) : {}
      const result = await input.onToolCall(functionCall.name, parsedArguments)
      if (result.sideEffect != null) {
        sideEffect = result.sideEffect
      }

      toolOutputs.push({
        type: 'function_call_output',
        call_id: functionCall.call_id,
        output: JSON.stringify(result.output),
      })
    }

    response = await createResponsesRequest({
      model: env.OPENAI_MODEL,
      instructions: input.systemPrompt,
      previous_response_id: response.id,
      max_output_tokens: 220,
      text: {
        format: { type: 'text' },
      },
      input: toolOutputs,
      tools: input.tools,
      tool_choice: 'auto',
    })
  }

  return {
    text: extractResponseText(response),
    sideEffect,
  }
}
