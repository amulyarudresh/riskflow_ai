import { createClient } from '@/utils/supabase/server'
import { NextResponse } from 'next/server'

type RouteContext = {
  params: Promise<{
    itemId: string
  }> | {
    itemId: string
  }
}

type UpdateAnswerRequest = {
  generated_answer?: string
}

type ItemOwnershipRow = {
  id: string
  questionnaire_id: string
}

export async function PATCH(req: Request, { params }: RouteContext) {
  try {
    const resolvedParams = await Promise.resolve(params)
    const itemId = resolvedParams.itemId?.trim()
    if (!itemId) {
      return NextResponse.json({ error: 'itemId is required' }, { status: 400 })
    }

    const body = (await req.json()) as UpdateAnswerRequest
    if (typeof body.generated_answer !== 'string') {
      return NextResponse.json({ error: 'generated_answer must be a string' }, { status: 400 })
    }

    const normalizedAnswer = body.generated_answer.trim()

    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: item, error: itemError } = await supabase
      .from('questionnaire_items')
      .select('id, questionnaire_id')
      .eq('id', itemId)
      .single()

    if (itemError || !item) {
      return NextResponse.json({ error: 'Questionnaire item not found' }, { status: 404 })
    }

    const itemRow = item as ItemOwnershipRow

    const { data: questionnaire, error: questionnaireError } = await supabase
      .from('questionnaires')
      .select('id')
      .eq('id', itemRow.questionnaire_id)
      .eq('created_by', user.id)
      .single()

    if (questionnaireError || !questionnaire) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { error: updateError } = await supabase
      .from('questionnaire_items')
      .update({ generated_answer: normalizedAnswer })
      .eq('id', itemId)

    if (updateError) {
      throw new Error(`Failed to update answer: ${updateError.message}`)
    }

    return NextResponse.json(
      {
        success: true,
        item_id: itemId,
        generated_answer: normalizedAnswer,
      },
      { status: 200 }
    )
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal Server Error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
