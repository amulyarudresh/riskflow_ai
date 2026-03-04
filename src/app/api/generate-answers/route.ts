import { createClient } from '@/utils/supabase/server'
import { NextResponse } from 'next/server'
import {
  buildGroundedAnswerUserPrompt,
  createGeminiEmbedding,
  generateGroundedAnswer,
  GROUNDED_QA_SYSTEM_PROMPT,
  NOT_FOUND_RESPONSE,
} from '@/utils/ai/gemini'

type GenerateRequestBody = {
  questionnaire_id?: string
  item_ids?: string[]
}

type QuestionnaireItemRow = {
  id: string
  question_text: string
  question_order?: number | null
}

type RetrievedChunkRow = {
  chunk_id: string
  document_id: string
  document_title: string
  chunk_text: string
  similarity: number
}

function toVectorLiteral(values: number[]): string {
  return `[${values.join(',')}]`
}

function isMissingColumnOrRelationError(message: string, names: string[]): boolean {
  const normalized = message.toLowerCase()
  return names.some((name) => normalized.includes(name.toLowerCase()))
}

export async function POST(req: Request) {
  const supabase = await createClient()
  let questionnaireId = ''
  let runId: string | null = null

  try {
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = (await req.json()) as GenerateRequestBody
    questionnaireId = body.questionnaire_id?.trim() ?? ''
    const requestedItemIds = Array.from(
      new Set(
        (body.item_ids ?? [])
          .filter((value): value is string => typeof value === 'string')
          .map((value) => value.trim())
          .filter(Boolean)
      )
    )
    const isPartialRegeneration = requestedItemIds.length > 0

    if (!questionnaireId) {
      return NextResponse.json({ error: 'questionnaire_id is required' }, { status: 400 })
    }

    const { data: questionnaire, error: questionnaireError } = await supabase
      .from('questionnaires')
      .select('id, title, created_by')
      .eq('id', questionnaireId)
      .single()

    if (questionnaireError || !questionnaire) {
      return NextResponse.json({ error: 'Questionnaire not found' }, { status: 404 })
    }

    if (questionnaire.created_by !== user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    await supabase
      .from('questionnaires')
      .update({ status: 'processing' })
      .eq('id', questionnaireId)
      .eq('created_by', user.id)

    let questionnaireItems: QuestionnaireItemRow[] = []

    const { data: orderedItems, error: orderedItemsError } = await supabase
      .from('questionnaire_items')
      .select('id, question_text, question_order, created_at')
      .eq('questionnaire_id', questionnaireId)
      .order('question_order', { ascending: true })
      .order('created_at', { ascending: true })

    if (orderedItemsError) {
      const missingOrderColumn = orderedItemsError.message
        .toLowerCase()
        .includes("could not find the 'question_order' column")
      if (!missingOrderColumn) {
        throw new Error(`Failed to load questionnaire items: ${orderedItemsError.message}`)
      }

      const { data: fallbackItems, error: fallbackItemsError } = await supabase
        .from('questionnaire_items')
        .select('id, question_text, created_at')
        .eq('questionnaire_id', questionnaireId)
        .order('created_at', { ascending: true })

      if (fallbackItemsError) {
        throw new Error(`Failed to load questionnaire items: ${fallbackItemsError.message}`)
      }

      questionnaireItems = (fallbackItems ?? []) as QuestionnaireItemRow[]
    } else {
      questionnaireItems = (orderedItems ?? []) as QuestionnaireItemRow[]
    }

    if (questionnaireItems.length === 0) {
      throw new Error('No questionnaire items found to process')
    }

    if (isPartialRegeneration) {
      const requestedSet = new Set(requestedItemIds)
      questionnaireItems = questionnaireItems.filter((item) => requestedSet.has(item.id))

      if (questionnaireItems.length === 0) {
        return NextResponse.json(
          { error: 'No matching questionnaire items found for partial regeneration' },
          { status: 400 }
        )
      }
    }

    let runTrackingEnabled = true
    const runMetadata = {
      initiated_by: user.id,
      source: 'dashboard',
    }

    const { data: runRow, error: runInsertError } = await supabase
      .from('questionnaire_runs')
      .insert({
        questionnaire_id: questionnaireId,
        run_type: isPartialRegeneration ? 'partial' : 'full',
        status: 'processing',
        requested_item_ids: requestedItemIds,
        total_questions: questionnaireItems.length,
        created_by: user.id,
        metadata: runMetadata,
      })
      .select('id')
      .single()

    if (runInsertError) {
      const missingRunSchema = isMissingColumnOrRelationError(runInsertError.message, [
        'questionnaire_runs',
        "could not find the 'run_type' column",
        "could not find the 'requested_item_ids' column",
        "could not find the 'metadata' column",
      ])

      if (!missingRunSchema) {
        throw new Error(`Failed to create questionnaire run: ${runInsertError.message}`)
      }

      runTrackingEnabled = false
    } else {
      runId = runRow.id as string
    }

    let processedCount = 0
    let answeredCount = 0
    let notFoundCount = 0

    for (const item of questionnaireItems) {
      const questionText = item.question_text?.trim()
      if (!questionText) continue

      const questionEmbedding = await createGeminiEmbedding(questionText)

      let retrievedChunks: RetrievedChunkRow[] = []
      if (questionEmbedding) {
        const embeddingLiteral = toVectorLiteral(questionEmbedding)
        const rpcVariants: Array<Record<string, unknown>> = [
          {
            query_embedding: questionEmbedding,
            match_count: 3,
            requesting_user: user.id,
          },
          {
            query_embedding: questionEmbedding,
            match_count: 3,
          },
          {
            p_query_embedding: questionEmbedding,
            p_match_count: 3,
            p_requesting_user: user.id,
          },
          {
            p_query_embedding: embeddingLiteral,
            p_match_count: 3,
            p_requesting_user: user.id,
          },
          {
            query_embedding: embeddingLiteral,
            match_count: 3,
            requesting_user: user.id,
          },
          {
            query_embedding: embeddingLiteral,
            match_count: 3,
          },
        ]

        let searchResolved = false
        let lastRpcError = ''

        for (const rpcArgs of rpcVariants) {
          const { data: matchResults, error: matchError } = await supabase.rpc(
            'match_document_chunks',
            rpcArgs
          )

          if (!matchError) {
            retrievedChunks = ((matchResults as RetrievedChunkRow[]) ?? []).filter(
              (row) => row && row.document_title && row.chunk_text
            )
            searchResolved = true
            break
          }

          lastRpcError = matchError.message
          const isFunctionSignatureMismatch =
            matchError.message.includes(
              'Could not choose the best candidate function between: public.match_document_chunks'
            ) ||
            matchError.message.includes(
              'Could not find the function public.match_document_chunks'
            )

          if (!isFunctionSignatureMismatch) {
            break
          }
        }

        if (!searchResolved) {
          throw new Error(
            `Similarity search failed: ${lastRpcError}. Apply the latest Supabase SQL migration for match_document_chunks and refresh the schema cache.`
          )
        }
      }

      const groundedChunks = retrievedChunks.map((chunk) => ({
        documentTitle: chunk.document_title,
        chunkText: chunk.chunk_text,
      }))

      const generatedAnswer = await generateGroundedAnswer(questionText, groundedChunks)
      const isAnswerFound = generatedAnswer !== NOT_FOUND_RESPONSE
      const citationTitles = isAnswerFound
        ? Array.from(new Set(retrievedChunks.map((chunk) => chunk.document_title)))
        : []
      const citedDocumentIds = isAnswerFound
        ? Array.from(new Set(retrievedChunks.map((chunk) => chunk.document_id)))
        : []
      const evidenceSnippets = isAnswerFound
        ? Array.from(new Set(retrievedChunks.map((chunk) => chunk.chunk_text.trim()).filter(Boolean))).slice(0, 3)
        : []
      const confidenceScore = isAnswerFound
        ? Math.max(...retrievedChunks.map((chunk) => chunk.similarity ?? 0), 0)
        : 0

      const { error: updateError } = await supabase
        .from('questionnaire_items')
        .update({
          generated_answer: generatedAnswer,
          citations: citationTitles,
          cited_document_ids: citedDocumentIds,
          evidence_snippets: evidenceSnippets,
          confidence_score: confidenceScore,
          is_answerable: isAnswerFound,
        })
        .eq('id', item.id)
        .eq('questionnaire_id', questionnaireId)

      if (updateError) {
        throw new Error(`Failed to update generated answer: ${updateError.message}`)
      }

      if (runTrackingEnabled && runId) {
        const { error: runItemInsertError } = await supabase
          .from('questionnaire_item_runs')
          .insert({
            run_id: runId,
            questionnaire_item_id: item.id,
            question_order: item.question_order ?? processedCount + 1,
            question_text: item.question_text,
            generated_answer: generatedAnswer,
            citations: citationTitles,
            evidence_snippets: evidenceSnippets,
            confidence_score: confidenceScore,
            is_answerable: isAnswerFound,
          })

        if (runItemInsertError) {
          const missingRunItemSchema = isMissingColumnOrRelationError(runItemInsertError.message, [
            'questionnaire_item_runs',
            "could not find the 'question_order' column",
            "could not find the 'citations' column",
            "could not find the 'evidence_snippets' column",
          ])

          if (!missingRunItemSchema) {
            throw new Error(`Failed to create questionnaire item run: ${runItemInsertError.message}`)
          }

          runTrackingEnabled = false
        }
      }

      processedCount += 1
      if (isAnswerFound) {
        answeredCount += 1
      } else {
        notFoundCount += 1
      }
    }

    await supabase
      .from('questionnaires')
      .update({ status: 'completed' })
      .eq('id', questionnaireId)
      .eq('created_by', user.id)

    if (runTrackingEnabled && runId) {
      await supabase
        .from('questionnaire_runs')
        .update({
          status: 'completed',
          processed_count: processedCount,
          answered_count: answeredCount,
          not_found_count: notFoundCount,
          completed_at: new Date().toISOString(),
        })
        .eq('id', runId)
        .eq('created_by', user.id)
    }

    return NextResponse.json(
      {
        success: true,
        questionnaire_id: questionnaireId,
        run_id: runId,
        mode: isPartialRegeneration ? 'partial' : 'full',
        processed_count: processedCount,
        answered_count: answeredCount,
        not_found_count: notFoundCount,
        prompt_system: GROUNDED_QA_SYSTEM_PROMPT,
        prompt_user_template: buildGroundedAnswerUserPrompt('<QUESTION>', [
          {
            documentTitle: '<SOURCE_DOCUMENT_NAME>',
            chunkText: '<RETRIEVED_TEXT_CHUNK>',
          },
        ]),
      },
      { status: 200 }
    )
  } catch (error: unknown) {
    if (questionnaireId) {
      await supabase.from('questionnaires').update({ status: 'draft' }).eq('id', questionnaireId)
    }

    if (runId) {
      await supabase
        .from('questionnaire_runs')
        .update({
          status: 'failed',
          error_message: error instanceof Error ? error.message : 'Internal Server Error',
          completed_at: new Date().toISOString(),
        })
        .eq('id', runId)
    }

    const message = error instanceof Error ? error.message : 'Internal Server Error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
