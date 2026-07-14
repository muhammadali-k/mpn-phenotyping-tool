import { extractJSON } from './engine'

type ProgressCallback = (msg: string, pct?: number) => void

interface WebLLMMessage {
  role: 'system' | 'user'
  content: string
}

interface WebLLMEngine {
  unload(): Promise<void>
  chat: {
    completions: {
      create(request: {
        messages: WebLLMMessage[]
        response_format: { type: 'json_object' }
        max_tokens: number
      }): Promise<{
        choices: Array<{ message: { content?: string | null } }>
      }>
    }
  }
}

let engineModelId: string | null = null
let enginePromise: Promise<WebLLMEngine> | null = null

async function getEngine(modelId: string, onProgress?: ProgressCallback): Promise<WebLLMEngine> {
  if (enginePromise && engineModelId === modelId) return enginePromise

  if (enginePromise && engineModelId !== modelId) {
    try {
      const previousEngine = await enginePromise
      await previousEngine.unload()
    } catch {
      // A failed initialization or unload must not prevent switching models.
    }
  }

  const webllm = await import('@mlc-ai/web-llm')
  engineModelId = modelId
  enginePromise = webllm.CreateMLCEngine(modelId, {
    initProgressCallback: (report) => onProgress?.('Preparing on-device model…', report.progress),
  })

  try {
    return await enginePromise
  } catch (error: unknown) {
    if (engineModelId === modelId) {
      engineModelId = null
      enginePromise = null
    }
    throw error
  }
}

export async function runWebLLM(
  modelId: string,
  messages: WebLLMMessage[],
  onProgress?: ProgressCallback,
): Promise<unknown> {
  const inputLength = messages.reduce((total, message) => total + message.content.length, 0)
  if (inputLength > 9000) {
    throw new Error(
      'The note/report is too long for the on-device model (4K context). Shorten it, or use Puter.js or your own API key.',
    )
  }

  const engine = await getEngine(modelId, onProgress)
  const response = await engine.chat.completions.create({
    messages,
    response_format: { type: 'json_object' },
    max_tokens: 1200,
  })
  const parsed = extractJSON(response.choices[0]?.message.content)
  if (parsed !== null) return parsed
  throw new Error('The on-device model returned unparseable output.')
}
