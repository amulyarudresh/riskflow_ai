import { createClient } from '@/utils/supabase/server'
import { NextResponse } from 'next/server'

type RouteContext = {
  params:
    | Promise<{
        questionnaireId: string
      }>
    | {
        questionnaireId: string
      }
}

type QuestionnaireRow = {
  id: string
  title: string
  created_by: string
}

function isMissingRunHistorySchemaError(message: string): boolean {
  const normalized = message.toLowerCase()
  return (
    normalized.includes('questionnaire_runs') ||
    normalized.includes("could not find the 'run_type' column") ||
    normalized.includes("could not find the 'processed_count' column") ||
    normalized.includes("could not find the 'requested_item_ids' column")
  )
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
      .select('id, title, created_by')
      .eq('id', questionnaireId)
      .single()

    if (questionnaireError || !questionnaire) {
      return NextResponse.json({ error: 'Questionnaire not found' }, { status: 404 })
    }

    const questionnaireRow = questionnaire as QuestionnaireRow
    if (questionnaireRow.created_by !== user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { data: runs, error: runsError } = await supabase
      .from('questionnaire_runs')
      .select(
        'id, run_type, status, requested_item_ids, total_questions, processed_count, answered_count, not_found_count, error_message, created_at, completed_at'
      )
      .eq('questionnaire_id', questionnaireId)
      .order('created_at', { ascending: false })
      .limit(50)

    if (runsError) {
      if (isMissingRunHistorySchemaError(runsError.message)) {
        return NextResponse.json(
          {
            success: true,
            questionnaire: {
              id: questionnaireRow.id,
              title: questionnaireRow.title,
            },
            runs: [],
          },
          { status: 200 }
        )
      }

      throw new Error(`Failed to load questionnaire runs: ${runsError.message}`)
    }

    return NextResponse.json(
      {
        success: true,
        questionnaire: {
          id: questionnaireRow.id,
          title: questionnaireRow.title,
        },
        runs: runs ?? [],
      },
      { status: 200 }
    )
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal Server Error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
