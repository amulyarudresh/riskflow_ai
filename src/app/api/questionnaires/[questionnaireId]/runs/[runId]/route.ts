import { createClient } from '@/utils/supabase/server'
import { NextResponse } from 'next/server'

type RouteContext = {
  params:
    | Promise<{
        questionnaireId: string
        runId: string
      }>
    | {
        questionnaireId: string
        runId: string
      }
}

type QuestionnaireRow = {
  id: string
  created_by: string
}

function isMissingRunHistorySchemaError(message: string): boolean {
  const normalized = message.toLowerCase()
  return normalized.includes('questionnaire_runs') || normalized.includes('questionnaire_item_runs')
}

export async function GET(_req: Request, { params }: RouteContext) {
  try {
    const resolvedParams = await Promise.resolve(params)
    const questionnaireId = resolvedParams.questionnaireId?.trim()
    const runId = resolvedParams.runId?.trim()

    if (!questionnaireId || !runId) {
      return NextResponse.json({ error: 'questionnaireId and runId are required' }, { status: 400 })
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
      .select('id, created_by')
      .eq('id', questionnaireId)
      .single()

    if (questionnaireError || !questionnaire) {
      return NextResponse.json({ error: 'Questionnaire not found' }, { status: 404 })
    }

    const questionnaireRow = questionnaire as QuestionnaireRow
    if (questionnaireRow.created_by !== user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { data: run, error: runError } = await supabase
      .from('questionnaire_runs')
      .select(
        'id, questionnaire_id, run_type, status, requested_item_ids, total_questions, processed_count, answered_count, not_found_count, error_message, created_at, completed_at'
      )
      .eq('id', runId)
      .eq('questionnaire_id', questionnaireId)
      .single()

    if (runError || !run) {
      if (runError && isMissingRunHistorySchemaError(runError.message)) {
        return NextResponse.json({ error: 'Run history schema not applied yet' }, { status: 400 })
      }
      return NextResponse.json({ error: 'Run not found' }, { status: 404 })
    }

    const { data: runItems, error: runItemsError } = await supabase
      .from('questionnaire_item_runs')
      .select(
        'questionnaire_item_id, question_order, question_text, generated_answer, citations, evidence_snippets, confidence_score, is_answerable, created_at'
      )
      .eq('run_id', runId)
      .order('question_order', { ascending: true })
      .order('created_at', { ascending: true })

    if (runItemsError) {
      if (isMissingRunHistorySchemaError(runItemsError.message)) {
        return NextResponse.json({ error: 'Run history schema not applied yet' }, { status: 400 })
      }
      throw new Error(`Failed to load run items: ${runItemsError.message}`)
    }

    return NextResponse.json(
      {
        success: true,
        run,
        items: runItems ?? [],
      },
      { status: 200 }
    )
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal Server Error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
