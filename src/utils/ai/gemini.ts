type GeminiPart = {
  text?: string
}

type GeminiErrorResponse = {
  error?: {
    message?: string
  }
}

type GeminiGenerateResponse = {
  candidates?: Array<{
    content?: {
      parts?: GeminiPart[]
    }
  }>
}

type GeminiModel = {
  name?: string
  supportedGenerationMethods?: string[]
}

type GeminiListModelsResponse = {
  models?: GeminiModel[]
}

export type GroundingChunk = {
  documentTitle: string
  chunkText: string
}

const geminiApiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || null
const GEMINI_EMBEDDING_MODEL = process.env.GEMINI_EMBEDDING_MODEL?.trim() || 'gemini-embedding-001'
const GEMINI_EMBEDDING_FALLBACK_MODEL = 'text-embedding-004'
const GEMINI_OUTPUT_DIMENSIONALITY = 1536
const GEMINI_TEXT_MODEL = process.env.GEMINI_TEXT_MODEL?.trim() || 'gemini-2.5-flash'
const GEMINI_TEXT_MODEL_FALLBACKS = [
  'gemini-2.5-flash',
  'gemini-2.5-pro',
  'gemini-2.0-flash',
  'gemini-flash-latest',
  'gemini-3-flash-preview',
  'gemini-3-pro-preview',
]

export const NOT_FOUND_RESPONSE = 'Not found in references.'
export const GROUNDED_QA_SYSTEM_PROMPT =
  'Answer the question using ONLY the provided context. If the answer is not in the context, output exactly: "Not found in references." If you find the answer, append a citation referencing the source document name.'

function ensureGeminiApiKey(): string {
  if (!geminiApiKey) {
    throw new Error('Gemini API key is not configured. Set GEMINI_API_KEY or GOOGLE_API_KEY.')
  }
  return geminiApiKey
}

function extractGeneratedText(payload: GeminiGenerateResponse): string {
  const parts = payload.candidates?.[0]?.content?.parts
  if (!parts || parts.length === 0) return ''
  return parts
    .map((part) => part.text ?? '')
    .join('\n')
    .trim()
}

export async function createGeminiEmbedding(input: string): Promise<number[] | null> {
  if (!geminiApiKey) return null

  const apiKey = ensureGeminiApiKey()
  const modelsToTry = Array.from(new Set([GEMINI_EMBEDDING_MODEL, GEMINI_EMBEDDING_FALLBACK_MODEL]))
  let lastError: string | null = null

  for (const modelName of modelsToTry) {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:embedContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          content: {
            parts: [{ text: input }],
          },
          outputDimensionality: GEMINI_OUTPUT_DIMENSIONALITY,
        }),
      }
    )

    if (response.ok) {
      const payload = (await response.json()) as { embedding?: { values?: number[] } }
      const embedding = payload.embedding?.values
      if (embedding && embedding.length > 0) {
        return embedding
      }
      lastError = `Model ${modelName} returned no embedding values`
      continue
    }

    const errorMessage = await response.text()
    if (response.status === 404) {
      lastError = `Model ${modelName} unavailable`
      continue
    }

    throw new Error(`Gemini embedding request failed (${response.status}): ${errorMessage.slice(0, 220)}`)
  }

  throw new Error(
    `Gemini embedding model unavailable. Tried ${modelsToTry.join(', ')}. ${lastError ?? ''}`.trim()
  )
}

export function buildGroundedAnswerUserPrompt(question: string, chunks: GroundingChunk[]): string {
  const normalizedChunks = chunks.length
    ? chunks
        .map(
          (chunk, index) =>
            `Context ${index + 1}\nSource: ${chunk.documentTitle}\nText:\n${chunk.chunkText}`
        )
        .join('\n\n---\n\n')
    : 'No context provided.'

  return `Question:\n${question}\n\nContext:\n${normalizedChunks}`
}

function normalizeGeneratedAnswer(rawText: string): string {
  const trimmed = rawText.trim()
  if (!trimmed) return NOT_FOUND_RESPONSE

  const normalized = trimmed.toLowerCase().replace(/["'.]/g, '')
  if (normalized === 'not found in references' || normalized.startsWith('not found in references')) {
    return NOT_FOUND_RESPONSE
  }

  return trimmed
}

function hasGenerationModelNotFoundError(status: number, body: string): boolean {
  if (status !== 404) return false
  return body.includes('not found for API version') || body.includes('not supported for generateContent')
}

function extractGeminiErrorMessage(body: string): string {
  try {
    const parsed = JSON.parse(body) as GeminiErrorResponse
    return parsed.error?.message?.trim() || body.trim()
  } catch {
    return body.trim()
  }
}

async function generateWithModel(
  apiKey: string,
  modelName: string,
  question: string,
  chunks: GroundingChunk[]
): Promise<{ ok: true; answer: string } | { ok: false; retryableModelError: boolean; errorMessage: string }> {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        system_instruction: {
          parts: [{ text: GROUNDED_QA_SYSTEM_PROMPT }],
        },
        contents: [
          {
            role: 'user',
            parts: [{ text: buildGroundedAnswerUserPrompt(question, chunks) }],
          },
        ],
        generationConfig: {
          temperature: 0.1,
        },
      }),
    }
  )

  if (!response.ok) {
    const errorBody = await response.text()
    const errorMessage = extractGeminiErrorMessage(errorBody).slice(0, 260)
    return {
      ok: false,
      retryableModelError: hasGenerationModelNotFoundError(response.status, errorBody),
      errorMessage,
    }
  }

  const payload = (await response.json()) as GeminiGenerateResponse
  return { ok: true, answer: normalizeGeneratedAnswer(extractGeneratedText(payload)) }
}

async function listGenerateContentModels(apiKey: string): Promise<string[]> {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`,
    {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    }
  )

  if (!response.ok) return []

  const payload = (await response.json()) as GeminiListModelsResponse
  const models = payload.models ?? []
  return models
    .filter((model) => model.supportedGenerationMethods?.includes('generateContent'))
    .map((model) => model.name?.replace(/^models\//, '').trim())
    .filter((modelName): modelName is string => Boolean(modelName))
}

export async function generateGroundedAnswer(question: string, chunks: GroundingChunk[]): Promise<string> {
  if (chunks.length === 0) return NOT_FOUND_RESPONSE

  const apiKey = ensureGeminiApiKey()
  const staticCandidates = Array.from(new Set([GEMINI_TEXT_MODEL, ...GEMINI_TEXT_MODEL_FALLBACKS]))
  const triedModels: string[] = []
  let lastModelError = ''

  for (const modelName of staticCandidates) {
    const result = await generateWithModel(apiKey, modelName, question, chunks)
    triedModels.push(modelName)

    if (result.ok) {
      const answer = result.answer
      if (answer === NOT_FOUND_RESPONSE) return answer

      const hasSourceCitation = /\bsource\b|\[.*\]/i.test(answer)
      if (hasSourceCitation) return answer

      const topSource = chunks[0]?.documentTitle
      return topSource ? `${answer} [Source: ${topSource}]` : answer
    }

    lastModelError = result.errorMessage
    if (!result.retryableModelError) {
      throw new Error(`Gemini generation request failed: ${result.errorMessage}`)
    }
  }

  const discoveredCandidates = await listGenerateContentModels(apiKey)
  for (const modelName of discoveredCandidates) {
    if (triedModels.includes(modelName)) continue

    const result = await generateWithModel(apiKey, modelName, question, chunks)
    triedModels.push(modelName)

    if (result.ok) {
      const answer = result.answer
      if (answer === NOT_FOUND_RESPONSE) return answer

      const hasSourceCitation = /\bsource\b|\[.*\]/i.test(answer)
      if (hasSourceCitation) return answer

      const topSource = chunks[0]?.documentTitle
      return topSource ? `${answer} [Source: ${topSource}]` : answer
    }

    lastModelError = result.errorMessage
    if (!result.retryableModelError) {
      throw new Error(`Gemini generation request failed: ${result.errorMessage}`)
    }
  }

  throw new Error(
    `Gemini generation model unavailable. Tried: ${triedModels.join(', ')}. Last error: ${lastModelError || 'No compatible generateContent model found.'}`
  )
}
