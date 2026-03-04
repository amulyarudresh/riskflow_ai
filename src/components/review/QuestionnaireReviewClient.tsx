'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { downloadExportFile } from '@/utils/export/csv'

const NOT_FOUND_RESPONSE = 'Not found in references.'

type ReviewQuestionnaire = {
  id: string
  title: string
  status: 'draft' | 'processing' | 'completed'
}

type ReviewItem = {
  id: string
  order: number
  question: string
  generated_answer: string
  citations: string[]
  evidence_snippets: string[]
  is_not_found: boolean
}

type ReviewResponse = {
  success?: boolean
  questionnaire?: ReviewQuestionnaire
  coverage_summary?: {
    total_questions: number
    answered_with_citations: number
    not_found_in_references: number
  }
  items?: ReviewItem[]
  error?: string
}

type UpdateAnswerResponse = {
  success?: boolean
  item_id?: string
  generated_answer?: string
  error?: string
}

type GenerateAnswersResponse = {
  success?: boolean
  run_id?: string | null
  mode?: 'full' | 'partial'
  processed_count?: number
  answered_count?: number
  not_found_count?: number
  error?: string
}

type RunSummary = {
  id: string
  run_type: 'full' | 'partial'
  status: 'processing' | 'completed' | 'failed'
  requested_item_ids?: string[]
  total_questions?: number
  processed_count?: number
  answered_count?: number
  not_found_count?: number
  error_message?: string | null
  created_at: string
  completed_at?: string | null
}

type RunsListResponse = {
  success?: boolean
  runs?: RunSummary[]
  error?: string
}

type RunDetailItem = {
  questionnaire_item_id: string
  question_order?: number | null
  question_text: string
  generated_answer?: string | null
  citations?: string[]
  evidence_snippets?: string[]
  confidence_score?: number | null
  is_answerable?: boolean
  created_at: string
}

type RunDetailsResponse = {
  success?: boolean
  run?: RunSummary
  items?: RunDetailItem[]
  error?: string
}

function Spinner({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg
      className={`animate-spin ${className}`}
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
      />
    </svg>
  )
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message
  return 'Unexpected error. Please try again.'
}

async function parseResponseJson<T>(response: Response): Promise<T | null> {
  try {
    return (await response.json()) as T
  } catch {
    return null
  }
}

function formatRunTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date)
}

export default function QuestionnaireReviewClient({ questionnaireId }: { questionnaireId: string }) {
  const [loading, setLoading] = useState(true)
  const [errorMessage, setErrorMessage] = useState('')
  const [noticeMessage, setNoticeMessage] = useState('')

  const [questionnaire, setQuestionnaire] = useState<ReviewQuestionnaire | null>(null)
  const [items, setItems] = useState<ReviewItem[]>([])
  const [draftAnswers, setDraftAnswers] = useState<Record<string, string>>({})
  const [selectedItemIds, setSelectedItemIds] = useState<Record<string, boolean>>({})
  const [expandedEvidence, setExpandedEvidence] = useState<Record<string, boolean>>({})

  const [savingItemId, setSavingItemId] = useState<string | null>(null)
  const [isExporting, setIsExporting] = useState(false)
  const [isRegenerating, setIsRegenerating] = useState(false)

  const [runsLoading, setRunsLoading] = useState(true)
  const [runs, setRuns] = useState<RunSummary[]>([])
  const [selectedRun, setSelectedRun] = useState<RunSummary | null>(null)
  const [selectedRunItems, setSelectedRunItems] = useState<RunDetailItem[]>([])
  const [loadingRunDetails, setLoadingRunDetails] = useState(false)

  const loadReviewData = useCallback(async () => {
    setLoading(true)
    setErrorMessage('')

    try {
      const response = await fetch(`/api/questionnaires/${questionnaireId}/review`, {
        method: 'GET',
        cache: 'no-store',
      })

      const data = await parseResponseJson<ReviewResponse>(response)
      if (!response.ok || !data?.questionnaire) {
        throw new Error(data?.error ?? 'Failed to load review data.')
      }

      const loadedItems = data.items ?? []
      setQuestionnaire(data.questionnaire)
      setItems(loadedItems)
      setDraftAnswers(Object.fromEntries(loadedItems.map((item) => [item.id, item.generated_answer ?? ''])))
      setSelectedItemIds({})
      setExpandedEvidence({})
    } catch (error: unknown) {
      setErrorMessage(getErrorMessage(error))
    } finally {
      setLoading(false)
    }
  }, [questionnaireId])

  const loadRunHistory = useCallback(async () => {
    setRunsLoading(true)

    try {
      const response = await fetch(`/api/questionnaires/${questionnaireId}/runs`, {
        method: 'GET',
        cache: 'no-store',
      })

      const data = await parseResponseJson<RunsListResponse>(response)
      if (!response.ok) {
        throw new Error(data?.error ?? 'Failed to load run history.')
      }

      setRuns(data?.runs ?? [])
    } catch (error: unknown) {
      setErrorMessage(getErrorMessage(error))
    } finally {
      setRunsLoading(false)
    }
  }, [questionnaireId])

  useEffect(() => {
    void loadReviewData()
    void loadRunHistory()
  }, [loadReviewData, loadRunHistory])

  const rowsInOrder = useMemo(
    () =>
      items.map((item) => ({
        ...item,
        answer: draftAnswers[item.id] ?? item.generated_answer ?? '',
      })),
    [items, draftAnswers]
  )

  const currentAnswersByItemId = useMemo(() => {
    const map = new Map<string, string>()
    rowsInOrder.forEach((item) => {
      map.set(item.id, item.answer)
    })
    return map
  }, [rowsInOrder])

  const coverageSummary = useMemo(() => {
    const totalQuestions = rowsInOrder.length
    const answeredWithCitations = rowsInOrder.filter((item) => {
      const normalizedAnswer = item.answer.trim()
      return normalizedAnswer.length > 0 && normalizedAnswer !== NOT_FOUND_RESPONSE && item.citations.length > 0
    }).length
    const notFoundInReferences = rowsInOrder.filter((item) => item.answer.trim() === NOT_FOUND_RESPONSE).length

    return {
      totalQuestions,
      answeredWithCitations,
      notFoundInReferences,
    }
  }, [rowsInOrder])

  const selectedCount = useMemo(
    () => rowsInOrder.filter((item) => selectedItemIds[item.id]).length,
    [rowsInOrder, selectedItemIds]
  )

  const handleAnswerChange = useCallback((itemId: string, value: string) => {
    setDraftAnswers((prev) => ({
      ...prev,
      [itemId]: value,
    }))
  }, [])

  const handleToggleEvidence = useCallback((itemId: string) => {
    setExpandedEvidence((prev) => ({
      ...prev,
      [itemId]: !prev[itemId],
    }))
  }, [])

  const handleToggleItemSelection = useCallback((itemId: string) => {
    setSelectedItemIds((prev) => ({
      ...prev,
      [itemId]: !prev[itemId],
    }))
  }, [])

  const handleSelectAllToggle = useCallback(() => {
    const shouldSelectAll = selectedCount !== rowsInOrder.length
    if (!shouldSelectAll) {
      setSelectedItemIds({})
      return
    }

    setSelectedItemIds(Object.fromEntries(rowsInOrder.map((item) => [item.id, true])))
  }, [rowsInOrder, selectedCount])

  const handleSaveAnswer = useCallback(
    async (itemId: string) => {
      const currentDraft = draftAnswers[itemId] ?? ''
      setSavingItemId(itemId)
      setErrorMessage('')
      setNoticeMessage('')

      try {
        const response = await fetch(`/api/questionnaire-items/${itemId}`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ generated_answer: currentDraft }),
        })

        const data = await parseResponseJson<UpdateAnswerResponse>(response)
        if (!response.ok) {
          throw new Error(data?.error ?? 'Failed to update answer.')
        }

        const updatedAnswer = data?.generated_answer ?? currentDraft.trim()
        setItems((prev) =>
          prev.map((item) =>
            item.id === itemId
              ? {
                  ...item,
                  generated_answer: updatedAnswer,
                  is_not_found: updatedAnswer === NOT_FOUND_RESPONSE,
                }
              : item
          )
        )

        setDraftAnswers((prev) => ({
          ...prev,
          [itemId]: updatedAnswer,
        }))
      } catch (error: unknown) {
        setErrorMessage(getErrorMessage(error))
      } finally {
        setSavingItemId(null)
      }
    },
    [draftAnswers]
  )

  const handleRegenerateSelected = useCallback(async () => {
    const selectedIds = rowsInOrder.filter((item) => selectedItemIds[item.id]).map((item) => item.id)
    if (selectedIds.length === 0) return

    setIsRegenerating(true)
    setErrorMessage('')
    setNoticeMessage('')

    try {
      const response = await fetch('/api/generate-answers', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          questionnaire_id: questionnaireId,
          item_ids: selectedIds,
        }),
      })

      const data = await parseResponseJson<GenerateAnswersResponse>(response)
      if (!response.ok) {
        throw new Error(data?.error ?? 'Failed to regenerate selected answers.')
      }

      setNoticeMessage(
        `Regenerated ${data?.processed_count ?? selectedIds.length} selected question(s)${data?.run_id ? ` • Run ${data.run_id.slice(0, 8)}` : ''}.`
      )
      setSelectedItemIds({})

      await Promise.all([loadReviewData(), loadRunHistory()])
    } catch (error: unknown) {
      setErrorMessage(getErrorMessage(error))
    } finally {
      setIsRegenerating(false)
    }
  }, [loadReviewData, loadRunHistory, questionnaireId, rowsInOrder, selectedItemIds])

  const handleExport = useCallback(() => {
    if (!questionnaire) return

    setIsExporting(true)
    setErrorMessage('')
    setNoticeMessage('')

    void downloadExportFile(
      `/api/questionnaires/${questionnaireId}/export`,
      `${questionnaire.title}-answered.csv`
    )
      .catch((error: unknown) => {
        setErrorMessage(getErrorMessage(error))
      })
      .finally(() => {
        setIsExporting(false)
      })
  }, [questionnaire, questionnaireId])

  const handleLoadRunDetails = useCallback(
    async (runId: string) => {
      setLoadingRunDetails(true)
      setErrorMessage('')

      try {
        const response = await fetch(`/api/questionnaires/${questionnaireId}/runs/${runId}`, {
          method: 'GET',
          cache: 'no-store',
        })

        const data = await parseResponseJson<RunDetailsResponse>(response)
        if (!response.ok || !data?.run) {
          throw new Error(data?.error ?? 'Failed to load run details.')
        }

        setSelectedRun(data.run)
        setSelectedRunItems(data.items ?? [])
      } catch (error: unknown) {
        setErrorMessage(getErrorMessage(error))
      } finally {
        setLoadingRunDetails(false)
      }
    },
    [questionnaireId]
  )

  if (loading) {
    return (
      <section className="rounded-3xl border border-white/10 bg-white/5 p-8 text-indigo-100">
        <div className="inline-flex items-center gap-2 text-sm text-indigo-200/80">
          <Spinner />
          Loading review workspace...
        </div>
      </section>
    )
  }

  if (!questionnaire) {
    return (
      <section className="rounded-3xl border border-rose-400/35 bg-rose-500/10 p-8 text-rose-100">
        <p className="text-sm font-medium">Unable to open review page.</p>
        <p className="mt-1 text-sm text-rose-100/80">{errorMessage || 'Questionnaire not found.'}</p>
        <Link
          href="/dashboard"
          className="mt-4 inline-flex items-center rounded-lg border border-rose-300/35 bg-rose-400/10 px-3 py-2 text-xs font-semibold text-rose-100 transition hover:bg-rose-400/20"
        >
          Back to dashboard
        </Link>
      </section>
    )
  }

  return (
    <section className="space-y-6">
      <article className="relative overflow-hidden rounded-3xl border border-white/10 bg-white/5 p-6 shadow-lg shadow-indigo-950/10 backdrop-blur-md sm:p-7">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_right,_rgba(124,58,237,0.16),_transparent_46%),radial-gradient(circle_at_bottom_left,_rgba(14,165,233,0.12),_transparent_44%)]" />
        <div className="relative flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-violet-400/35 bg-violet-500/15 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-violet-100">
              Review Workspace
            </div>
            <h2 className="mt-3 text-2xl font-semibold text-white sm:text-3xl">{questionnaire.title}</h2>
            <p className="mt-2 text-sm text-indigo-200/80">
              Status: <span className="font-semibold text-indigo-100">{questionnaire.status}</span>
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={handleRegenerateSelected}
              disabled={selectedCount === 0 || isRegenerating}
              className="inline-flex items-center rounded-lg border border-emerald-400/35 bg-emerald-500/10 px-4 py-2.5 text-sm font-semibold text-emerald-100 transition hover:bg-emerald-500/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300/70 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isRegenerating ? (
                <span className="inline-flex items-center gap-2">
                  <Spinner className="h-3.5 w-3.5" />
                  Regenerating...
                </span>
              ) : (
                `Regenerate Selected (${selectedCount})`
              )}
            </button>

            <button
              type="button"
              onClick={handleExport}
              disabled={rowsInOrder.length === 0 || isExporting}
              className="inline-flex items-center rounded-lg border border-indigo-400/35 bg-indigo-500/15 px-4 py-2.5 text-sm font-semibold text-indigo-100 transition hover:bg-indigo-500/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300/70 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isExporting ? 'Exporting...' : 'Export'}
            </button>

            <Link
              href="/dashboard"
              className="inline-flex items-center rounded-lg border border-white/20 bg-white/5 px-4 py-2.5 text-sm font-semibold text-indigo-100 transition hover:bg-white/10"
            >
              Back to dashboard
            </Link>
          </div>
        </div>
      </article>

      <article className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
          <p className="text-xs uppercase tracking-[0.14em] text-indigo-200/65">Total Questions</p>
          <p className="mt-2 text-2xl font-semibold text-white">{coverageSummary.totalQuestions}</p>
        </div>
        <div className="rounded-2xl border border-emerald-400/35 bg-emerald-500/10 p-4">
          <p className="text-xs uppercase tracking-[0.14em] text-emerald-100/90">Answered With Citations</p>
          <p className="mt-2 text-2xl font-semibold text-emerald-100">{coverageSummary.answeredWithCitations}</p>
        </div>
        <div className="rounded-2xl border border-amber-400/35 bg-amber-500/10 p-4">
          <p className="text-xs uppercase tracking-[0.14em] text-amber-100/90">Not Found In References</p>
          <p className="mt-2 text-2xl font-semibold text-amber-100">{coverageSummary.notFoundInReferences}</p>
        </div>
      </article>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-indigo-100">
        <p>Selected for partial regeneration: <span className="font-semibold">{selectedCount}</span></p>
        <button
          type="button"
          onClick={handleSelectAllToggle}
          className="inline-flex items-center rounded-lg border border-white/20 bg-white/5 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.1em] text-indigo-100 transition hover:bg-white/10"
        >
          {selectedCount === rowsInOrder.length ? 'Clear selection' : 'Select all'}
        </button>
      </div>

      {errorMessage ? (
        <div className="rounded-2xl border border-rose-400/35 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
          {errorMessage}
        </div>
      ) : null}

      {noticeMessage ? (
        <div className="rounded-2xl border border-emerald-400/35 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100">
          {noticeMessage}
        </div>
      ) : null}

      <article className="space-y-4">
        {rowsInOrder.map((item) => {
          const isSaving = savingItemId === item.id
          const hasUnsavedChanges = item.answer !== item.generated_answer
          const hasEvidence = item.evidence_snippets.length > 0
          const evidenceVisible = expandedEvidence[item.id] ?? false
          const isSelected = Boolean(selectedItemIds[item.id])

          return (
            <div key={item.id} className="rounded-2xl border border-white/10 bg-white/5 p-4 sm:p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="inline-flex items-center gap-2">
                    <input
                      id={`select-item-${item.id}`}
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => handleToggleItemSelection(item.id)}
                      className="h-4 w-4 rounded border-white/30 bg-slate-900 text-emerald-500 focus:ring-2 focus:ring-emerald-400/60"
                    />
                    <label htmlFor={`select-item-${item.id}`} className="text-xs uppercase tracking-[0.12em] text-emerald-200/90">
                      Include in partial regeneration
                    </label>
                  </div>

                  <p className="mt-2 text-xs uppercase tracking-[0.14em] text-indigo-300">Question {item.order}</p>
                  <p className="mt-1 text-sm leading-6 text-indigo-100">{item.question}</p>
                </div>

                {item.answer.trim() === NOT_FOUND_RESPONSE ? (
                  <span className="rounded-full border border-amber-400/35 bg-amber-500/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-amber-100">
                    Not found
                  </span>
                ) : (
                  <span className="rounded-full border border-emerald-400/35 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-emerald-100">
                    Answered
                  </span>
                )}
              </div>

              <div className="mt-4 space-y-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.12em] text-indigo-200/65">Generated Answer</p>
                  <textarea
                    value={item.answer}
                    onChange={(event) => handleAnswerChange(item.id, event.target.value)}
                    rows={5}
                    className="mt-1.5 block w-full rounded-xl border border-white/15 bg-white/5 px-3.5 py-2.5 text-sm leading-6 text-white placeholder:text-indigo-200/50 focus:border-indigo-500 focus:outline-none focus:ring-4 focus:ring-indigo-500/15"
                  />
                </div>

                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.12em] text-indigo-200/65">Citation</p>
                  {item.citations.length > 0 ? (
                    <div className="mt-1.5 flex flex-wrap gap-2">
                      {item.citations.map((citation) => (
                        <span
                          key={`${item.id}-${citation}`}
                          className="rounded-full border border-indigo-400/35 bg-indigo-500/10 px-2.5 py-1 text-xs font-medium text-indigo-100"
                        >
                          {citation}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <p className="mt-1.5 text-sm text-indigo-200/60">No citation available.</p>
                  )}
                </div>

                <div>
                  <button
                    type="button"
                    disabled={!hasEvidence}
                    onClick={() => handleToggleEvidence(item.id)}
                    className="inline-flex items-center rounded-lg border border-violet-400/35 bg-violet-500/10 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.1em] text-violet-100 transition hover:bg-violet-500/20 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {evidenceVisible ? 'Hide evidence snippet' : 'View evidence snippet'}
                  </button>

                  {evidenceVisible ? (
                    <div className="mt-3 space-y-2">
                      {item.evidence_snippets.map((snippet, index) => (
                        <pre
                          key={`${item.id}-snippet-${index}`}
                          className="overflow-x-auto whitespace-pre-wrap rounded-xl border border-white/10 bg-slate-950/50 p-3 text-xs leading-5 text-indigo-100/90"
                        >
                          {snippet}
                        </pre>
                      ))}
                    </div>
                  ) : null}
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    disabled={!hasUnsavedChanges || isSaving}
                    onClick={() => void handleSaveAnswer(item.id)}
                    className="inline-flex items-center rounded-lg bg-indigo-600 px-3.5 py-2 text-xs font-semibold text-white transition hover:bg-indigo-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300/70 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {isSaving ? (
                      <span className="inline-flex items-center gap-2">
                        <Spinner className="h-3.5 w-3.5" />
                        Saving...
                      </span>
                    ) : (
                      'Save answer'
                    )}
                  </button>

                  {hasUnsavedChanges ? (
                    <p className="text-xs text-amber-100/85">Unsaved changes</p>
                  ) : (
                    <p className="text-xs text-emerald-100/85">Saved</p>
                  )}
                </div>
              </div>
            </div>
          )
        })}

        {rowsInOrder.length === 0 ? (
          <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-indigo-200/70">
            No questions found for this questionnaire.
          </div>
        ) : null}
      </article>

      <article className="rounded-3xl border border-white/10 bg-white/5 p-5 shadow-sm shadow-slate-900/5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-sm font-semibold uppercase tracking-[0.14em] text-indigo-200/80">Run History</h3>
          {runsLoading ? (
            <span className="inline-flex items-center gap-2 text-xs text-indigo-200/70">
              <Spinner className="h-3.5 w-3.5" />
              Loading runs...
            </span>
          ) : null}
        </div>

        {runs.length === 0 ? (
          <p className="mt-4 rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-indigo-200/60">
            No runs recorded yet for this questionnaire.
          </p>
        ) : (
          <ul className="mt-4 space-y-3">
            {runs.map((run) => (
              <li key={run.id} className="rounded-xl border border-white/10 bg-white/5 px-3 py-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-indigo-100">
                      Run {run.id.slice(0, 8)} • {run.run_type}
                    </p>
                    <p className="mt-1 text-xs text-indigo-200/70">
                      {formatRunTime(run.created_at)} • status: {run.status}
                    </p>
                    <p className="mt-1 text-xs text-indigo-200/70">
                      Processed: {run.processed_count ?? 0} / {run.total_questions ?? 0} • Answered: {run.answered_count ?? 0} • Not found: {run.not_found_count ?? 0}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void handleLoadRunDetails(run.id)}
                    className="inline-flex items-center rounded-lg border border-indigo-400/35 bg-indigo-500/10 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.1em] text-indigo-100 transition hover:bg-indigo-500/20"
                  >
                    View snapshot
                  </button>
                </div>
                {run.status === 'failed' && run.error_message ? (
                  <p className="mt-2 text-xs text-rose-200/90">{run.error_message}</p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </article>

      <article className="rounded-3xl border border-white/10 bg-white/5 p-5 shadow-sm shadow-slate-900/5 sm:p-6">
        <h3 className="text-sm font-semibold uppercase tracking-[0.14em] text-indigo-200/80">Run Snapshot</h3>

        {loadingRunDetails ? (
          <div className="mt-4 inline-flex items-center gap-2 text-sm text-indigo-200/80">
            <Spinner />
            Loading run details...
          </div>
        ) : selectedRun ? (
          <div className="mt-4 space-y-3">
            <p className="text-sm text-indigo-100">
              Viewing run <span className="font-semibold">{selectedRun.id.slice(0, 8)}</span> ({selectedRun.run_type})
            </p>

            {selectedRunItems.length === 0 ? (
              <p className="rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-indigo-200/70">
                No item snapshots available for this run.
              </p>
            ) : (
              <ul className="space-y-3">
                {selectedRunItems.map((runItem, index) => {
                  const runAnswer = runItem.generated_answer?.trim() ?? ''
                  const currentAnswer = currentAnswersByItemId.get(runItem.questionnaire_item_id)?.trim() ?? ''
                  const differsFromCurrent = runAnswer !== currentAnswer

                  return (
                    <li key={`${runItem.questionnaire_item_id}-${index}`} className="rounded-xl border border-white/10 bg-white/5 px-3 py-3">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <p className="text-sm font-medium text-indigo-100">
                          Q{runItem.question_order ?? index + 1}: {runItem.question_text}
                        </p>
                        {differsFromCurrent ? (
                          <span className="rounded-full border border-amber-400/35 bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-amber-100">
                            Current differs
                          </span>
                        ) : (
                          <span className="rounded-full border border-emerald-400/35 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-emerald-100">
                            Matches current
                          </span>
                        )}
                      </div>

                      <p className="mt-2 text-xs text-indigo-200/80">Run answer:</p>
                      <p className="mt-1 whitespace-pre-wrap text-sm text-indigo-100/90">
                        {runAnswer || 'No answer generated.'}
                      </p>

                      {Array.isArray(runItem.citations) && runItem.citations.length > 0 ? (
                        <p className="mt-2 text-xs text-indigo-200/70">Citations: {runItem.citations.join(' | ')}</p>
                      ) : null}
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        ) : (
          <p className="mt-4 rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-indigo-200/70">
            Select a run from history to view a snapshot.
          </p>
        )}
      </article>
    </section>
  )
}
