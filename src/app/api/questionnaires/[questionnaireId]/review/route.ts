import { createClient } from '@/utils/supabase/server'
import { NextResponse } from 'next/server'

const NOT_FOUND_RESPONSE = 'Not found in references.'

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
  status: 'draft' | 'processing' | 'completed'
  created_by: string
}

type QuestionnaireItemRow = {
  id: string
  question_order?: number | null
  question_text: string
  generated_answer: string | null
  citations?: string[] | null
  evidence_snippets?: string[] | null
  created_at: string
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
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

    const { data: questionnaire, error: questionnaireError } = await supabase
      .from('questionnaires')
      .select('id, title, status, created_by')
      .eq('id', questionnaireId)
      .single()

    if (questionnaireError || !questionnaire) {
      return NextResponse.json({ error: 'Questionnaire not found' }, { status: 404 })
    }

    const questionnaireRow = questionnaire as QuestionnaireRow
    if (questionnaireRow.created_by !== user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const richSelect =
      'id, question_order, question_text, generated_answer, citations, evidence_snippets, created_at'
    const fallbackSelect = 'id, question_text, generated_answer, created_at'

    let items: QuestionnaireItemRow[] = []

    const { data: richItems, error: richError } = await supabase
      .from('questionnaire_items')
      .select(richSelect)
      .eq('questionnaire_id', questionnaireId)
      .order('question_order', { ascending: true })
      .order('created_at', { ascending: true })

    if (richError) {
      const message = richError.message.toLowerCase()
      const missingOptionalColumns =
        message.includes("could not find the 'citations' column") ||
        message.includes("could not find the 'evidence_snippets' column") ||
        message.includes("could not find the 'question_order' column")

      if (!missingOptionalColumns) {
        throw new Error(`Failed to load questionnaire items: ${richError.message}`)
      }

      const { data: basicItems, error: basicError } = await supabase
        .from('questionnaire_items')
        .select(fallbackSelect)
        .eq('questionnaire_id', questionnaireId)
        .order('created_at', { ascending: true })

      if (basicError) {
        throw new Error(`Failed to load questionnaire items: ${basicError.message}`)
      }

      items = (basicItems ?? []) as QuestionnaireItemRow[]
    } else {
      items = (richItems ?? []) as QuestionnaireItemRow[]
    }

    const normalizedItems = items.map((item, index) => {
      const answer = item.generated_answer?.trim() ?? ''
      return {
        id: item.id,
        order: item.question_order && item.question_order > 0 ? item.question_order : index + 1,
        question: item.question_text,
        generated_answer: answer,
        citations: toStringArray(item.citations),
        evidence_snippets: toStringArray(item.evidence_snippets),
        is_not_found: answer === NOT_FOUND_RESPONSE,
      }
    })

    const answeredWithCitationsCount = normalizedItems.filter(
      (item) => !item.is_not_found && item.citations.length > 0
    ).length
    const notFoundCount = normalizedItems.filter((item) => item.is_not_found).length

    return NextResponse.json(
      {
        success: true,
        questionnaire: {
          id: questionnaireRow.id,
          title: questionnaireRow.title,
          status: questionnaireRow.status,
        },
        coverage_summary: {
          total_questions: normalizedItems.length,
          answered_with_citations: answeredWithCitationsCount,
          not_found_in_references: notFoundCount,
        },
        items: normalizedItems,
      },
      { status: 200 }
    )
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal Server Error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
