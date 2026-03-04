import { createClient } from '@/utils/supabase/server'
import { NextResponse } from 'next/server'

type RouteContext = {
  params: Promise<{
    questionnaireId: string
  }> | {
    questionnaireId: string
  }
}

type QuestionnaireRow = {
  id: string
  title: string
  created_by: string
  source_format?: string | null
  source_payload?: unknown
}

type QuestionnaireItemRow = {
  question_text: string
  generated_answer: string | null
  citations?: string[] | null
}

type RowRecord = Record<string, string | null | undefined>

const QUESTION_KEYS = ['question', 'text', 'prompt', 'query']

function escapeCsvCell(value: string): string {
  const normalized = value.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  if (/[,"\n]/.test(normalized)) {
    return `"${normalized.replace(/"/g, '""')}"`
  }
  return normalized
}

function buildCsvFromRows(headers: string[], rows: RowRecord[]): string {
  const safeHeaders = headers.length > 0 ? headers : Object.keys(rows[0] ?? {})
  const lines: string[] = [safeHeaders.map(escapeCsvCell).join(',')]

  rows.forEach((row) => {
    const cells = safeHeaders.map((header) => escapeCsvCell(String(row?.[header] ?? '')))
    lines.push(cells.join(','))
  })

  return lines.join('\n')
}

function buildSimpleReviewCsv(items: Array<{ question: string; answer: string; citation: string }>): string {
  const headers = ['Question', 'Answer', 'Citation']
  const rows = items.map((item) => ({
    Question: item.question,
    Answer: item.answer,
    Citation: item.citation,
  }))
  return buildCsvFromRows(headers, rows)
}

function toCitationString(value: unknown): string {
  if (!Array.isArray(value)) return ''
  return value
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .join(' | ')
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function annotateJsonWithAnswers(
  input: unknown,
  answers: Array<{ answer: string; citation: string }>
): unknown {
  let cursor = 0

  const annotate = (value: unknown): unknown => {
    if (Array.isArray(value)) {
      return value.map((entry) => annotate(entry))
    }

    if (!isObject(value)) {
      return value
    }

    const transformed: Record<string, unknown> = {}
    Object.entries(value).forEach(([key, nestedValue]) => {
      transformed[key] = annotate(nestedValue)
    })

    const questionKey = QUESTION_KEYS.find((key) => {
      const candidate = value[key]
      return typeof candidate === 'string' && candidate.trim().length > 0
    })

    if (questionKey) {
      const answerEntry = answers[cursor] ?? { answer: '', citation: '' }
      cursor += 1
      transformed.answer = answerEntry.answer
      transformed.citation = answerEntry.citation
    }

    return transformed
  }

  return annotate(input)
}

function sanitizeBaseName(input: string): string {
  const cleaned = input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_\s]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')

  return cleaned || 'questionnaire-export'
}

export async function GET(_req: Request, { params }: RouteContext) {
  try {
    const resolvedParams = await Promise.resolve(params)
    const questionnaireId = resolvedParams.questionnaireId?.trim()
    if (!questionnaireId) {
      return NextResponse.json({ error: 'questionnaireId is required' }, { status: 400 })
    }

    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    let questionnaireRow: QuestionnaireRow | null = null

    const { data: questionnaireWithSource, error: questionnaireWithSourceError } = await supabase
      .from('questionnaires')
      .select('id, title, created_by, source_format, source_payload')
      .eq('id', questionnaireId)
      .single()

    if (questionnaireWithSourceError) {
      const missingSourceColumns =
        questionnaireWithSourceError.message
          .toLowerCase()
          .includes("could not find the 'source_format' column") ||
        questionnaireWithSourceError.message
          .toLowerCase()
          .includes("could not find the 'source_payload' column")

      if (!missingSourceColumns) {
        throw new Error(`Failed to load questionnaire: ${questionnaireWithSourceError.message}`)
      }

      const { data: fallbackQuestionnaire, error: fallbackQuestionnaireError } = await supabase
        .from('questionnaires')
        .select('id, title, created_by')
        .eq('id', questionnaireId)
        .single()

      if (fallbackQuestionnaireError || !fallbackQuestionnaire) {
        return NextResponse.json({ error: 'Questionnaire not found' }, { status: 404 })
      }

      questionnaireRow = fallbackQuestionnaire as QuestionnaireRow
    } else {
      questionnaireRow = questionnaireWithSource as QuestionnaireRow
    }

    if (!questionnaireRow) {
      return NextResponse.json({ error: 'Questionnaire not found' }, { status: 404 })
    }

    if (questionnaireRow.created_by !== user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    let items: QuestionnaireItemRow[] = []

    const { data: orderedItems, error: orderedItemsError } = await supabase
      .from('questionnaire_items')
      .select('question_text, generated_answer, citations, question_order, created_at')
      .eq('questionnaire_id', questionnaireId)
      .order('question_order', { ascending: true })
      .order('created_at', { ascending: true })

    if (orderedItemsError) {
      const message = orderedItemsError.message.toLowerCase()
      const missingColumns =
        message.includes("could not find the 'question_order' column") ||
        message.includes("could not find the 'citations' column")

      if (!missingColumns) {
        throw new Error(`Failed to load questionnaire items: ${orderedItemsError.message}`)
      }

      const { data: fallbackItems, error: fallbackItemsError } = await supabase
        .from('questionnaire_items')
        .select('question_text, generated_answer, created_at')
        .eq('questionnaire_id', questionnaireId)
        .order('created_at', { ascending: true })

      if (fallbackItemsError) {
        throw new Error(`Failed to load questionnaire items: ${fallbackItemsError.message}`)
      }

      items = (fallbackItems ?? []) as QuestionnaireItemRow[]
    } else {
      items = (orderedItems ?? []) as QuestionnaireItemRow[]
    }

    const normalizedRows = items.map((item) => ({
      question: item.question_text,
      answer: item.generated_answer?.trim() ?? '',
      citation: toCitationString(item.citations),
    }))

    const baseName = sanitizeBaseName(questionnaireRow.title)
    const sourceFormat = (questionnaireRow.source_format ?? '').toLowerCase()
    const sourcePayload = questionnaireRow.source_payload

    if (sourceFormat === 'csv' && isObject(sourcePayload)) {
      const headersRaw = sourcePayload.headers
      const rowsRaw = sourcePayload.rows
      const questionKeyRaw = sourcePayload.questionKey

      if (Array.isArray(headersRaw) && Array.isArray(rowsRaw) && typeof questionKeyRaw === 'string') {
        const headers = headersRaw
          .filter((header): header is string => typeof header === 'string')
          .map((header) => header.trim())
          .filter(Boolean)

        const rows = rowsRaw.filter((row): row is RowRecord => isObject(row))
        const answerHeader = 'Answer'
        const citationHeader = 'Citation'
        const outputHeaders = Array.from(new Set([...headers, answerHeader, citationHeader]))

        let answerIndex = 0
        const outputRows = rows.map((row) => {
          const value = row[questionKeyRaw]
          const hasQuestion = typeof value === 'string' && value.trim().length > 0
          const answerEntry = hasQuestion
            ? normalizedRows[answerIndex++] ?? { question: '', answer: '', citation: '' }
            : { question: '', answer: '', citation: '' }

          return {
            ...row,
            [answerHeader]: answerEntry.answer,
            [citationHeader]: answerEntry.citation,
          }
        })

        const csv = buildCsvFromRows(outputHeaders, outputRows)
        return new NextResponse(csv, {
          status: 200,
          headers: {
            'Content-Type': 'text/csv; charset=utf-8',
            'Content-Disposition': `attachment; filename="${baseName}-answered.csv"`,
          },
        })
      }
    }

    if (sourceFormat === 'json' && isObject(sourcePayload) && 'parsed' in sourcePayload) {
      const annotated = annotateJsonWithAnswers(
        (sourcePayload as Record<string, unknown>).parsed,
        normalizedRows.map((row) => ({ answer: row.answer, citation: row.citation }))
      )

      const jsonText = `${JSON.stringify(annotated, null, 2)}\n`
      return new NextResponse(jsonText, {
        status: 200,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Content-Disposition': `attachment; filename="${baseName}-answered.json"`,
        },
      })
    }

    const fallbackCsv = buildSimpleReviewCsv(normalizedRows)
    return new NextResponse(fallbackCsv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${baseName}-answered.csv"`,
      },
    })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal Server Error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
