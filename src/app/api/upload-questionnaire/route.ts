import { createClient } from '@/utils/supabase/server'
import { NextResponse } from 'next/server'
import Papa from 'papaparse'

type JsonRecord = Record<string, unknown>

type ParsedQuestion = {
  questionText: string
}

type ParsedQuestionnaire = {
  sourceFormat: 'csv' | 'json'
  sourcePayload: JsonRecord
  questions: ParsedQuestion[]
}

function isNonEmptyQuestion(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function normalizeQuestion(candidate: unknown): string | null {
  if (isNonEmptyQuestion(candidate)) {
    return candidate
  }

  if (candidate && typeof candidate === 'object') {
    const record = candidate as JsonRecord
    const prioritizedKeys = ['question', 'text', 'prompt', 'query']

    for (const key of prioritizedKeys) {
      const value = record[key]
      if (isNonEmptyQuestion(value)) {
        return value
      }
    }
  }

  return null
}

function extractQuestionsFromJson(parsed: unknown): ParsedQuestion[] {
  const questions: ParsedQuestion[] = []
  const append = (candidate: unknown) => {
    const normalized = normalizeQuestion(candidate)
    if (normalized) questions.push({ questionText: normalized })
  }

  if (Array.isArray(parsed)) {
    parsed.forEach(append)
    return questions
  }

  if (parsed && typeof parsed === 'object') {
    const record = parsed as JsonRecord
    append(record)

    const nestedArrays = [record.questions, record.items, record.data]
    nestedArrays.forEach((value) => {
      if (Array.isArray(value)) {
        value.forEach(append)
      }
    })

    if (record.data && typeof record.data === 'object' && !Array.isArray(record.data)) {
      const dataRecord = record.data as JsonRecord
      if (Array.isArray(dataRecord.questions)) {
        dataRecord.questions.forEach(append)
      }
    }
  }

  return questions
}

function parseCsvQuestionnaire(text: string): ParsedQuestionnaire {
  const parsed = Papa.parse<Record<string, string | undefined>>(text, {
    header: true,
    skipEmptyLines: false,
  })

  const rows = parsed.data
  const firstRow = rows.find((row) => row && typeof row === 'object')
  const headers = parsed.meta.fields ?? (firstRow ? Object.keys(firstRow) : [])

  if (headers.length === 0) {
    return {
      sourceFormat: 'csv',
      sourcePayload: {
        headers: [],
        rows: [],
        questionKey: null,
      },
      questions: [],
    }
  }

  const questionKey = headers.find((key) => key.toLowerCase().includes('question')) ?? headers[0]
  const questions: ParsedQuestion[] = []

  rows.forEach((row) => {
    const value = row?.[questionKey]
    if (isNonEmptyQuestion(value)) {
      questions.push({ questionText: value })
    }
  })

  return {
    sourceFormat: 'csv',
    sourcePayload: {
      headers,
      rows,
      questionKey,
    },
    questions,
  }
}

function parseJsonQuestionnaire(text: string): ParsedQuestionnaire {
  const parsed = JSON.parse(text)
  return {
    sourceFormat: 'json',
    sourcePayload: {
      parsed,
    },
    questions: extractQuestionsFromJson(parsed),
  }
}

function isMissingColumnError(message: string, columnName: string): boolean {
  return message.toLowerCase().includes(`could not find the '${columnName.toLowerCase()}' column`)
}

export async function POST(req: Request) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const formData = await req.formData()
    const title = formData.get('title') as string
    const file = formData.get('file') as File

    if (!title || !file) {
      return NextResponse.json({ error: 'Title and file are required' }, { status: 400 })
    }

    const text = await file.text()
    const extension = file.name.split('.').pop()?.toLowerCase()

    let parsedQuestionnaire: ParsedQuestionnaire
    if (extension === 'csv') {
      parsedQuestionnaire = parseCsvQuestionnaire(text)
    } else if (extension === 'json') {
      parsedQuestionnaire = parseJsonQuestionnaire(text)
    } else {
      throw new Error('Unsupported file type. Use JSON or CSV.')
    }

    if (parsedQuestionnaire.questions.length === 0) {
      throw new Error('No valid questions found in the parsed document')
    }

    let questionnaireId = ''

    const { data: questionnaireWithSource, error: headerWithSourceError } = await supabase
      .from('questionnaires')
      .insert({
        title,
        status: 'draft',
        created_by: user.id,
        source_format: parsedQuestionnaire.sourceFormat,
        source_payload: parsedQuestionnaire.sourcePayload,
      })
      .select('id')
      .single()

    if (headerWithSourceError) {
      const sourceColumnsMissing =
        isMissingColumnError(headerWithSourceError.message, 'source_format') ||
        isMissingColumnError(headerWithSourceError.message, 'source_payload')

      if (!sourceColumnsMissing) {
        throw new Error(`Failed to create questionnaire: ${headerWithSourceError.message}`)
      }

      const { data: questionnaireFallback, error: headerFallbackError } = await supabase
        .from('questionnaires')
        .insert({
          title,
          status: 'draft',
          created_by: user.id,
        })
        .select('id')
        .single()

      if (headerFallbackError || !questionnaireFallback) {
        throw new Error(
          `Failed to create questionnaire: ${headerFallbackError?.message ?? 'Unknown error'}`
        )
      }

      questionnaireId = questionnaireFallback.id
    } else {
      questionnaireId = questionnaireWithSource.id
    }

    const itemsToInsertWithOrder = parsedQuestionnaire.questions.map((entry, index) => ({
      questionnaire_id: questionnaireId,
      question_order: index + 1,
      question_text: entry.questionText,
      is_answerable: true,
    }))

    const { error: itemsWithOrderError } = await supabase
      .from('questionnaire_items')
      .insert(itemsToInsertWithOrder)

    if (itemsWithOrderError) {
      const orderColumnMissing = isMissingColumnError(itemsWithOrderError.message, 'question_order')
      if (!orderColumnMissing) {
        throw new Error(`Failed to create questionnaire items: ${itemsWithOrderError.message}`)
      }

      const fallbackItems = parsedQuestionnaire.questions.map((entry) => ({
        questionnaire_id: questionnaireId,
        question_text: entry.questionText,
        is_answerable: true,
      }))

      const { error: fallbackItemsError } = await supabase
        .from('questionnaire_items')
        .insert(fallbackItems)

      if (fallbackItemsError) {
        throw new Error(`Failed to create questionnaire items: ${fallbackItemsError.message}`)
      }
    }

    return NextResponse.json(
      {
        success: true,
        count: parsedQuestionnaire.questions.length,
        questionnaire_id: questionnaireId,
      },
      { status: 200 }
    )
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal Server Error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
