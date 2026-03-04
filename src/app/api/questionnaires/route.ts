import { createClient } from '@/utils/supabase/server'
import { NextResponse } from 'next/server'

const NOT_FOUND_RESPONSE = 'Not found in references.'

type QuestionnaireRow = {
  id: string
  title: string
  status: 'draft' | 'processing' | 'completed'
}

type QuestionnaireItemRow = {
  questionnaire_id: string
  generated_answer: string | null
}

export async function GET() {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: questionnaires, error: questionnaireError } = await supabase
      .from('questionnaires')
      .select('id, title, status')
      .eq('created_by', user.id)
      .order('created_at', { ascending: false })
      .limit(30)

    if (questionnaireError) {
      throw new Error(`Failed to load questionnaires: ${questionnaireError.message}`)
    }

    const rows = (questionnaires ?? []) as QuestionnaireRow[]
    if (rows.length === 0) {
      return NextResponse.json({ success: true, questionnaires: [] }, { status: 200 })
    }

    const questionnaireIds = rows.map((row) => row.id)

    const { data: items, error: itemsError } = await supabase
      .from('questionnaire_items')
      .select('questionnaire_id, generated_answer')
      .in('questionnaire_id', questionnaireIds)

    if (itemsError) {
      throw new Error(`Failed to load questionnaire items: ${itemsError.message}`)
    }

    const itemRows = (items ?? []) as QuestionnaireItemRow[]
    const countsByQuestionnaire = new Map<
      string,
      { total: number; answered: number; notFound: number }
    >()

    itemRows.forEach((item) => {
      const current = countsByQuestionnaire.get(item.questionnaire_id) ?? {
        total: 0,
        answered: 0,
        notFound: 0,
      }

      current.total += 1

      const answer = item.generated_answer?.trim()
      if (answer) {
        if (answer === NOT_FOUND_RESPONSE) {
          current.notFound += 1
        } else {
          current.answered += 1
        }
      }

      countsByQuestionnaire.set(item.questionnaire_id, current)
    })

    const questionnaireSummaries = rows.map((row) => {
      const counts = countsByQuestionnaire.get(row.id) ?? { total: 0, answered: 0, notFound: 0 }
      return {
        id: row.id,
        title: row.title,
        status: row.status,
        count: counts.total,
        answered_count: counts.answered,
        not_found_count: counts.notFound,
      }
    })

    return NextResponse.json({ success: true, questionnaires: questionnaireSummaries }, { status: 200 })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal Server Error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
