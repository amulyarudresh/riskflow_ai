'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'

type ToastType = 'success' | 'error' | 'info'

interface Toast {
  id: number
  type: ToastType
  title: string
  message: string
}

interface UploadDocumentResponse {
  success?: boolean
  chunks_indexed?: number
  error?: string
}

interface UploadQuestionnaireResponse {
  success?: boolean
  count?: number
  questionnaire_id?: string
  error?: string
}

interface GenerateAnswersResponse {
  success?: boolean
  questionnaire_id?: string
  processed_count?: number
  answered_count?: number
  not_found_count?: number
  prompt_system?: string
  prompt_user_template?: string
  error?: string
}

interface ListQuestionnairesResponse {
  success?: boolean
  questionnaires?: Array<{
    id: string
    title: string
    status: 'draft' | 'processing' | 'completed'
    count: number
    answered_count: number
    not_found_count: number
  }>
  error?: string
}

interface Activity {
  id: number
  title: string
  detail: string
  time: string
}

interface UploadedQuestionnaire {
  id: string
  title: string
  count: number
  status: 'ready' | 'processing' | 'completed'
  answeredCount?: number
  notFoundCount?: number
}

const DOC_STEPS = ['Validate content', 'Generate embeddings', 'Store chunks']
const QUESTIONNAIRE_STEPS = ['Validate file', 'Parse questions', 'Save question items']
const SUPPORTED_REFERENCE_FILE_EXTENSIONS = ['txt', 'md', 'markdown', 'csv', 'json']
const MAX_REFERENCE_FILE_SIZE_BYTES = 10 * 1024 * 1024
const MAX_QUESTIONNAIRE_SIZE_BYTES = 5 * 1024 * 1024

let toastId = 0
let activityId = 0

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

function ToastContainer({
  toasts,
  onDismiss,
}: {
  toasts: Toast[]
  onDismiss: (id: number) => void
}) {
  return (
    <div className="pointer-events-none fixed inset-x-4 bottom-4 z-50 flex flex-col gap-3 sm:bottom-auto sm:left-auto sm:right-6 sm:top-6 sm:w-[26rem]">
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} onDismiss={onDismiss} />
      ))}
    </div>
  )
}

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: (id: number) => void }) {
  useEffect(() => {
    const timer = setTimeout(() => onDismiss(toast.id), 5000)
    return () => clearTimeout(timer)
  }, [toast.id, onDismiss])

  const styleByType: Record<ToastType, string> = {
    success: 'border-emerald-400/35 bg-emerald-500/15 text-emerald-100',
    error: 'border-rose-400/35 bg-rose-500/15 text-rose-100',
    info: 'border-sky-400/35 bg-sky-500/15 text-sky-100',
  }

  return (
    <div
      role="alert"
      className={`pointer-events-auto flex items-start gap-3 rounded-2xl border px-4 py-3.5 shadow-xl shadow-slate-950/10 backdrop-blur animate-[slideIn_0.3s_ease-out] ${styleByType[toast.type]}`}
    >
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">{toast.title}</p>
        <p className="mt-0.5 text-sm opacity-90">{toast.message}</p>
      </div>
      <button
        onClick={() => onDismiss(toast.id)}
        className="rounded-md p-1 opacity-70 transition hover:bg-white/10 hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300/70"
        aria-label="Dismiss notification"
      >
        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  )
}

function ProgressSteps({ steps, currentStep }: { steps: string[]; currentStep: number }) {
  return (
    <ol className="mt-4 grid gap-2.5 sm:grid-cols-3">
      {steps.map((step, index) => {
        const completed = index < currentStep
        const active = index === currentStep
        return (
          <li
            key={step}
            className={`rounded-xl border px-3 py-2 text-xs font-medium transition ${
              completed
                ? 'border-emerald-400/35 bg-emerald-500/15 text-emerald-100'
                : active
                  ? 'border-violet-400/35 bg-violet-500/15 text-violet-100'
                  : 'border-white/10 bg-white/5 text-indigo-200/60'
            }`}
          >
            <span className="mr-2 inline-flex h-5 w-5 items-center justify-center rounded-full border text-[10px] font-bold">
              {completed ? 'OK' : index + 1}
            </span>
            {step}
          </li>
        )
      })}
    </ol>
  )
}

function formatFileSize(sizeInBytes: number): string {
  if (sizeInBytes < 1024) return `${sizeInBytes} B`
  if (sizeInBytes < 1024 * 1024) return `${(sizeInBytes / 1024).toFixed(1)} KB`
  return `${(sizeInBytes / (1024 * 1024)).toFixed(1)} MB`
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

export default function DashboardClient({
  userId,
  userEmail,
}: {
  userId: string
  userEmail: string
}) {
  const [docTitle, setDocTitle] = useState('')
  const [docContent, setDocContent] = useState('')
  const [selectedDocumentFile, setSelectedDocumentFile] = useState<File | null>(null)

  const [questionnaireTitle, setQuestionnaireTitle] = useState('')
  const [selectedQuestionnaireFile, setSelectedQuestionnaireFile] = useState<File | null>(null)

  const [docLoading, setDocLoading] = useState(false)
  const [questionnaireLoading, setQuestionnaireLoading] = useState(false)
  const [generatingQuestionnaireId, setGeneratingQuestionnaireId] = useState<string | null>(null)

  const [docStep, setDocStep] = useState(0)
  const [questionnaireStep, setQuestionnaireStep] = useState(0)
  const [questionnairesLoading, setQuestionnairesLoading] = useState(true)
  const [isDraggingDocumentFile, setIsDraggingDocumentFile] = useState(false)
  const [isDraggingQuestionnaireFile, setIsDraggingQuestionnaireFile] = useState(false)

  const [uploadedQuestionnaires, setUploadedQuestionnaires] = useState<UploadedQuestionnaire[]>([])
  const [toasts, setToasts] = useState<Toast[]>([])
  const [activities, setActivities] = useState<Activity[]>([])

  const addToast = useCallback((type: ToastType, title: string, message: string) => {
    toastId += 1
    setToasts((prev) => [...prev, { id: toastId, type, title, message }])
  }, [])

  const dismissToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id))
  }, [])

  const timeFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(undefined, {
        hour: 'numeric',
        minute: '2-digit',
      }),
    []
  )

  const addActivity = useCallback(
    (title: string, detail: string) => {
      activityId += 1
      setActivities((prev) => [{ id: activityId, title, detail, time: timeFormatter.format(new Date()) }, ...prev].slice(0, 5))
    },
    [timeFormatter]
  )

  const mapQuestionnaireStatus = (status: 'draft' | 'processing' | 'completed') => {
    if (status === 'draft') return 'ready'
    return status
  }

  const loadQuestionnaires = useCallback(async () => {
    setQuestionnairesLoading(true)

    try {
      const response = await fetch('/api/questionnaires', {
        method: 'GET',
        cache: 'no-store',
      })

      const data = await parseResponseJson<ListQuestionnairesResponse>(response)
      if (!response.ok) throw new Error(data?.error ?? 'Failed to load questionnaires.')

      const summaries = data?.questionnaires ?? []
      setUploadedQuestionnaires(
        summaries.map((item) => ({
          id: item.id,
          title: item.title,
          count: item.count,
          status: mapQuestionnaireStatus(item.status),
          answeredCount: item.answered_count,
          notFoundCount: item.not_found_count,
        }))
      )
    } catch (error: unknown) {
      addToast('error', 'Unable to load questionnaires', getErrorMessage(error))
    } finally {
      setQuestionnairesLoading(false)
    }
  }, [addToast])

  useEffect(() => {
    void loadQuestionnaires()
  }, [loadQuestionnaires])

  const shortUserId = useMemo(() => userId.slice(0, 8), [userId])
  const firstName = useMemo(() => {
    const prefix = userEmail.split('@')[0] ?? 'there'
    return prefix.length > 0 ? prefix : 'there'
  }, [userEmail])

  const getFileExtension = (fileName: string): string | null => {
    const extension = fileName.split('.').pop()?.toLowerCase()
    return extension ?? null
  }

  const handleDocumentFileSelected = (file: File | null) => {
    if (!file) {
      setSelectedDocumentFile(null)
      return
    }

    const extension = getFileExtension(file.name)
    if (!extension || !SUPPORTED_REFERENCE_FILE_EXTENSIONS.includes(extension)) {
      addToast('error', 'Unsupported reference file', 'Use .txt, .md, .markdown, .csv, or .json.')
      return
    }

    if (file.size > MAX_REFERENCE_FILE_SIZE_BYTES) {
      addToast('error', 'File too large', 'Reference documents must be 10 MB or less.')
      return
    }

    setSelectedDocumentFile(file)
    if (!docTitle.trim()) {
      const titleFromFile = file.name.replace(/\.[^/.]+$/, '').trim()
      if (titleFromFile) setDocTitle(titleFromFile)
    }
  }

  const handleDocumentSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    const normalizedTitle = docTitle.trim()
    const normalizedContent = docContent.trim()

    if (!normalizedTitle) {
      addToast('error', 'Missing information', 'Document title is required.')
      return
    }

    if (!normalizedContent && !selectedDocumentFile) {
      addToast('error', 'Missing information', 'Paste document text or choose a file from your system.')
      return
    }

    if (normalizedContent && normalizedContent.length < 40 && !selectedDocumentFile) {
      addToast('error', 'Content too short', 'Add more context so retrieval stays accurate.')
      return
    }

    setDocLoading(true)
    setDocStep(0)

    try {
      await new Promise((resolve) => setTimeout(resolve, 250))
      setDocStep(1)

      const formData = new FormData()
      formData.append('title', normalizedTitle)
      if (normalizedContent) formData.append('content', normalizedContent)
      if (selectedDocumentFile) formData.append('file', selectedDocumentFile)

      const response = await fetch('/api/upload-document', {
        method: 'POST',
        body: formData,
      })

      setDocStep(2)
      const data = await parseResponseJson<UploadDocumentResponse>(response)
      if (!response.ok) throw new Error(data?.error ?? 'Failed to upload reference document.')

      addToast(
        'success',
        'Document indexed',
        `"${normalizedTitle}" indexed with ${data?.chunks_indexed ?? 0} chunks.`
      )
      addActivity('Document uploaded', normalizedTitle)

      setDocTitle('')
      setDocContent('')
      setSelectedDocumentFile(null)
    } catch (error: unknown) {
      addToast('error', 'Document upload failed', getErrorMessage(error))
    } finally {
      setDocLoading(false)
      setDocStep(0)
    }
  }

  const handleQuestionnaireSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (!questionnaireTitle.trim()) {
      addToast('error', 'Missing title', 'Add a questionnaire title before submitting.')
      return
    }

    if (!selectedQuestionnaireFile) {
      addToast('error', 'Missing file', 'Select a JSON or CSV questionnaire file.')
      return
    }

    const extension = selectedQuestionnaireFile.name.split('.').pop()?.toLowerCase()
    if (!extension || !['csv', 'json'].includes(extension)) {
      addToast('error', 'Unsupported format', 'Only .csv and .json files are supported.')
      return
    }

    if (selectedQuestionnaireFile.size > MAX_QUESTIONNAIRE_SIZE_BYTES) {
      addToast('error', 'File too large', 'Keep questionnaire files at 5 MB or less.')
      return
    }

    setQuestionnaireLoading(true)
    setQuestionnaireStep(0)

    try {
      await new Promise((resolve) => setTimeout(resolve, 250))
      setQuestionnaireStep(1)

      const formData = new FormData()
      formData.append('title', questionnaireTitle.trim())
      formData.append('file', selectedQuestionnaireFile)

      const response = await fetch('/api/upload-questionnaire', {
        method: 'POST',
        body: formData,
      })

      setQuestionnaireStep(2)
      const data = await parseResponseJson<UploadQuestionnaireResponse>(response)
      if (!response.ok) throw new Error(data?.error ?? 'Failed to upload questionnaire.')

      const parsedCount = data?.count ?? 0
      const questionnaireId = data?.questionnaire_id

      if (questionnaireId) {
        setUploadedQuestionnaires((prev) => [
          {
            id: questionnaireId,
            title: questionnaireTitle.trim(),
            count: parsedCount,
            status: 'ready',
          },
          ...prev.filter((item) => item.id !== questionnaireId),
        ])
      }

      addToast(
        'success',
        'Questionnaire uploaded',
        `"${questionnaireTitle.trim()}" processed with ${parsedCount} questions.`
      )
      addActivity('Questionnaire uploaded', questionnaireTitle.trim())

      setQuestionnaireTitle('')
      setSelectedQuestionnaireFile(null)
    } catch (error: unknown) {
      addToast('error', 'Questionnaire upload failed', getErrorMessage(error))
    } finally {
      setQuestionnaireLoading(false)
      setQuestionnaireStep(0)
    }
  }

  const handleGenerateAnswers = async (questionnaireId: string, title: string) => {
    if (generatingQuestionnaireId) return

    setGeneratingQuestionnaireId(questionnaireId)
    setUploadedQuestionnaires((prev) =>
      prev.map((item) => (item.id === questionnaireId ? { ...item, status: 'processing' } : item))
    )

    try {
      const response = await fetch('/api/generate-answers', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ questionnaire_id: questionnaireId }),
      })

      const data = await parseResponseJson<GenerateAnswersResponse>(response)
      if (!response.ok) throw new Error(data?.error ?? 'Failed to generate answers.')

      setUploadedQuestionnaires((prev) =>
        prev.map((item) =>
          item.id === questionnaireId
            ? {
                ...item,
                status: 'completed',
                answeredCount: data?.answered_count ?? 0,
                notFoundCount: data?.not_found_count ?? 0,
              }
            : item
        )
      )

      addToast(
        'success',
        'Answers generated',
        `"${title}" processed: ${data?.answered_count ?? 0} answered, ${data?.not_found_count ?? 0} not found.`
      )
      addActivity('Answer generation completed', title)
    } catch (error: unknown) {
      setUploadedQuestionnaires((prev) =>
        prev.map((item) => (item.id === questionnaireId ? { ...item, status: 'ready' } : item))
      )
      addToast('error', 'Answer generation failed', getErrorMessage(error))
    } finally {
      setGeneratingQuestionnaireId(null)
    }
  }

  return (
    <>
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />

      <section className="relative overflow-hidden rounded-3xl border border-white/10 bg-white/5 p-6 shadow-lg shadow-indigo-950/5 backdrop-blur-md sm:p-7">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_right,_rgba(124,58,237,0.16),_transparent_46%),radial-gradient(circle_at_bottom_left,_rgba(14,165,233,0.12),_transparent_44%)]" />
        <div className="relative">
          <div className="flex flex-wrap items-center gap-3">
            <span className="rounded-full border border-violet-400/35 bg-violet-500/15 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-violet-100">
              Workspace Overview
            </span>
            <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] font-medium text-indigo-200/80">
              Session {shortUserId}
            </span>
          </div>
          <h2 className="mt-3 text-2xl font-semibold text-white sm:text-3xl">Welcome back, {firstName}.</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-indigo-200/80">
            Upload reference documents and questionnaires, then run grounded answer generation using your indexed
            context and strict citation rules.
          </p>

          <div className="mt-5 grid gap-3 sm:grid-cols-3">
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <p className="text-xs uppercase tracking-[0.14em] text-indigo-200/60">Document Embeddings</p>
              <p className="mt-1 text-sm font-semibold text-white">Gemini</p>
              <p className="mt-1 text-xs text-indigo-200/60">Chunk-level vector indexing in pgvector.</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <p className="text-xs uppercase tracking-[0.14em] text-indigo-200/60">Answer Pipeline</p>
              <p className="mt-1 text-sm font-semibold text-white">Top-3 context retrieval</p>
              <p className="mt-1 text-xs text-indigo-200/60">Strict grounded prompt with citations.</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <p className="text-xs uppercase tracking-[0.14em] text-indigo-200/60">Account Context</p>
              <p className="mt-1 truncate text-sm font-semibold text-white">{userEmail}</p>
              <p className="mt-1 text-xs text-indigo-200/60">Data scoped to your authenticated session.</p>
            </div>
          </div>
        </div>
      </section>

      <section className="mt-7 grid gap-6 lg:grid-cols-[minmax(0,2.1fr)_minmax(0,1fr)]">
        <div className="space-y-6">
          <article className="rounded-3xl border border-white/10 bg-white/5 p-5 shadow-sm shadow-slate-900/5 sm:p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs uppercase tracking-[0.14em] text-indigo-300">Step 1</p>
                <h3 className="mt-1 text-lg font-semibold text-white">Reference Documents</h3>
                <p className="mt-1 text-sm text-indigo-200/80">
                  Paste policy text or upload a file. Content is chunked and embedded for retrieval.
                </p>
              </div>
            </div>

            {docLoading && <ProgressSteps steps={DOC_STEPS} currentStep={docStep} />}

            <form onSubmit={handleDocumentSubmit} className="mt-4 space-y-4">
              <div>
                <label htmlFor="doc-title" className="block text-sm font-medium text-indigo-100">
                  Document title
                </label>
                <input
                  id="doc-title"
                  value={docTitle}
                  onChange={(event) => setDocTitle(event.target.value)}
                  disabled={docLoading}
                  required
                  className="mt-1.5 block w-full rounded-xl border border-white/15 bg-white/5 px-3.5 py-2.5 text-sm text-white placeholder:text-indigo-200/50 focus:border-indigo-500 focus:outline-none focus:ring-4 focus:ring-indigo-500/15 disabled:cursor-not-allowed disabled:opacity-70"
                  placeholder="e.g. Corporate Security Policy 2026"
                />
              </div>

              <div>
                <label htmlFor="doc-content" className="block text-sm font-medium text-indigo-100">
                  Document content (optional if file uploaded)
                </label>
                <textarea
                  id="doc-content"
                  rows={7}
                  value={docContent}
                  onChange={(event) => setDocContent(event.target.value)}
                  disabled={docLoading}
                  className="mt-1.5 block w-full rounded-xl border border-white/15 bg-white/5 px-3.5 py-2.5 text-sm leading-6 text-white placeholder:text-indigo-200/50 focus:border-indigo-500 focus:outline-none focus:ring-4 focus:ring-indigo-500/15 disabled:cursor-not-allowed disabled:opacity-70"
                  placeholder="Paste text to be indexed as reference context."
                />
              </div>

              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-indigo-200/60">Or upload file</p>
                <div
                  onDragOver={(event) => {
                    event.preventDefault()
                    if (!docLoading) setIsDraggingDocumentFile(true)
                  }}
                  onDragLeave={(event) => {
                    event.preventDefault()
                    setIsDraggingDocumentFile(false)
                  }}
                  onDrop={(event) => {
                    event.preventDefault()
                    setIsDraggingDocumentFile(false)
                    if (docLoading) return
                    handleDocumentFileSelected(event.dataTransfer.files.item(0))
                  }}
                  className={`rounded-2xl border-2 border-dashed p-4 transition ${
                    docLoading
                      ? 'cursor-not-allowed border-white/10 bg-white/5 opacity-70'
                      : isDraggingDocumentFile
                        ? 'border-indigo-400/60 bg-indigo-500/15'
                        : selectedDocumentFile
                          ? 'border-indigo-400/35 bg-indigo-500/10'
                          : 'border-white/15 bg-white/5 hover:border-white/25'
                  }`}
                >
                  <div className="flex flex-col items-center justify-center text-center">
                    <input
                      id="doc-file"
                      type="file"
                      accept=".txt,.md,.markdown,.csv,.json"
                      disabled={docLoading}
                      onChange={(event) => handleDocumentFileSelected(event.target.files?.item(0) ?? null)}
                      className="sr-only"
                    />
                    <label
                      htmlFor="doc-file"
                      className={`inline-flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition ${
                        docLoading
                          ? 'pointer-events-none border-white/10 bg-white/10 text-indigo-200/50'
                          : 'border-white/15 bg-white/5 text-indigo-100 hover:border-indigo-300 hover:text-indigo-200'
                      }`}
                    >
                      Select reference file
                    </label>
                    <p className="mt-3 text-xs text-indigo-200/60">or drag and drop .txt, .md, .csv, .json</p>

                    {selectedDocumentFile ? (
                      <div className="mt-4 w-full rounded-xl border border-indigo-400/35 bg-white/5 px-3 py-2 text-left">
                        <p className="truncate text-sm font-medium text-indigo-100">{selectedDocumentFile.name}</p>
                        <p className="mt-0.5 text-xs text-indigo-200/60">{formatFileSize(selectedDocumentFile.size)}</p>
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>

              <button
                type="submit"
                disabled={docLoading}
                className="relative w-full rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-indigo-500/25 transition hover:from-indigo-500 hover:to-violet-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/60 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <span className={docLoading ? 'invisible' : 'inline-flex items-center gap-2'}>
                  Upload and index document
                </span>
                {docLoading ? (
                  <span className="absolute inset-0 flex items-center justify-center gap-2">
                    <Spinner />
                    {DOC_STEPS[docStep] ?? 'Processing'}...
                  </span>
                ) : null}
              </button>
            </form>
          </article>

          <article className="rounded-3xl border border-white/10 bg-white/5 p-5 shadow-sm shadow-slate-900/5 sm:p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs uppercase tracking-[0.14em] text-violet-300">Step 2</p>
                <h3 className="mt-1 text-lg font-semibold text-white">Vendor Questionnaire</h3>
                <p className="mt-1 text-sm text-indigo-200/80">
                  Upload JSON/CSV, then trigger answer generation for each questionnaire.
                </p>
              </div>
            </div>

            {questionnaireLoading ? <ProgressSteps steps={QUESTIONNAIRE_STEPS} currentStep={questionnaireStep} /> : null}

            <form onSubmit={handleQuestionnaireSubmit} className="mt-4 space-y-4">
              <div>
                <label htmlFor="questionnaire-title" className="block text-sm font-medium text-indigo-100">
                  Questionnaire title
                </label>
                <input
                  id="questionnaire-title"
                  value={questionnaireTitle}
                  onChange={(event) => setQuestionnaireTitle(event.target.value)}
                  disabled={questionnaireLoading}
                  required
                  className="mt-1.5 block w-full rounded-xl border border-white/15 bg-white/5 px-3.5 py-2.5 text-sm text-white placeholder:text-indigo-200/50 focus:border-violet-500 focus:outline-none focus:ring-4 focus:ring-violet-500/15 disabled:cursor-not-allowed disabled:opacity-70"
                  placeholder="e.g. Acme Security Due Diligence"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-indigo-100">Questionnaire file</label>
                <div
                  onDragOver={(event) => {
                    event.preventDefault()
                    if (!questionnaireLoading) setIsDraggingQuestionnaireFile(true)
                  }}
                  onDragLeave={(event) => {
                    event.preventDefault()
                    setIsDraggingQuestionnaireFile(false)
                  }}
                  onDrop={(event) => {
                    event.preventDefault()
                    setIsDraggingQuestionnaireFile(false)
                    if (questionnaireLoading) return
                    setSelectedQuestionnaireFile(event.dataTransfer.files.item(0))
                  }}
                  className={`mt-1.5 rounded-2xl border-2 border-dashed p-4 transition ${
                    questionnaireLoading
                      ? 'cursor-not-allowed border-white/10 bg-white/5 opacity-70'
                      : isDraggingQuestionnaireFile
                        ? 'border-violet-400/60 bg-violet-500/15'
                        : selectedQuestionnaireFile
                          ? 'border-violet-400/35 bg-violet-500/10'
                          : 'border-white/15 bg-white/5 hover:border-white/25'
                  }`}
                >
                  <div className="flex flex-col items-center justify-center text-center">
                    <input
                      id="questionnaire-file"
                      type="file"
                      accept=".csv,.json"
                      disabled={questionnaireLoading}
                      onChange={(event) => setSelectedQuestionnaireFile(event.target.files?.item(0) ?? null)}
                      className="sr-only"
                    />
                    <label
                      htmlFor="questionnaire-file"
                      className={`inline-flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition ${
                        questionnaireLoading
                          ? 'pointer-events-none border-white/10 bg-white/10 text-indigo-200/50'
                          : 'border-white/15 bg-white/5 text-indigo-100 hover:border-violet-300 hover:text-violet-200'
                      }`}
                    >
                      Choose file
                    </label>
                    <p className="mt-3 text-xs text-indigo-200/60">or drag and drop .csv / .json</p>

                    {selectedQuestionnaireFile ? (
                      <div className="mt-4 w-full rounded-xl border border-violet-400/35 bg-white/5 px-3 py-2 text-left">
                        <p className="truncate text-sm font-medium text-indigo-100">{selectedQuestionnaireFile.name}</p>
                        <p className="mt-0.5 text-xs text-indigo-200/60">
                          {formatFileSize(selectedQuestionnaireFile.size)}
                        </p>
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>

              <button
                type="submit"
                disabled={questionnaireLoading}
                className="relative w-full rounded-xl bg-violet-600 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-violet-900/30 transition hover:bg-violet-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300/80 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <span className={questionnaireLoading ? 'invisible' : 'inline-flex items-center gap-2'}>
                  Upload questionnaire
                </span>
                {questionnaireLoading ? (
                  <span className="absolute inset-0 flex items-center justify-center gap-2">
                    <Spinner />
                    {QUESTIONNAIRE_STEPS[questionnaireStep] ?? 'Processing'}...
                  </span>
                ) : null}
              </button>
            </form>
          </article>
        </div>

        <aside className="space-y-6">
          <article className="rounded-3xl border border-white/10 bg-white/5 p-5 shadow-sm shadow-slate-900/5 sm:p-6">
            <h3 className="text-sm font-semibold uppercase tracking-[0.14em] text-indigo-200/80">Questionnaire Runs</h3>
            {questionnairesLoading ? (
              <p className="mt-4 rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-indigo-200/60">
                Loading existing questionnaires...
              </p>
            ) : uploadedQuestionnaires.length === 0 ? (
              <p className="mt-4 rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-indigo-200/60">
                Upload a questionnaire to enable Generate Answers.
              </p>
            ) : (
              <ul className="mt-4 space-y-3">
                {uploadedQuestionnaires.map((item) => (
                  <li key={item.id} className="rounded-xl border border-white/10 bg-white/5 px-3 py-3">
                    <p className="truncate text-sm font-semibold text-indigo-100">{item.title}</p>
                    <p className="mt-1 text-xs text-indigo-200/60">
                      {item.count} questions | status: {item.status}
                    </p>
                    {item.status === 'completed' ? (
                      <p className="mt-1 text-xs text-emerald-200/90">
                        Answered: {item.answeredCount ?? 0}, Not found: {item.notFoundCount ?? 0}
                      </p>
                    ) : null}
                    <button
                      type="button"
                      disabled={generatingQuestionnaireId !== null || item.status === 'processing'}
                      onClick={() => handleGenerateAnswers(item.id, item.title)}
                      className="mt-3 inline-flex w-full items-center justify-center rounded-lg border border-indigo-400/35 bg-indigo-500/15 px-3 py-2 text-xs font-semibold text-indigo-100 transition hover:bg-indigo-500/25 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {generatingQuestionnaireId === item.id ? (
                        <span className="inline-flex items-center gap-2">
                          <Spinner className="h-3.5 w-3.5" />
                          Generating answers...
                        </span>
                      ) : item.status === 'processing' ? (
                        'Processing answers...'
                      ) : item.status === 'completed' ? (
                        'Regenerate Answers'
                      ) : (
                        'Generate Answers'
                      )}
                    </button>
                    <Link
                      href={`/dashboard/review/${item.id}`}
                      className="mt-2 inline-flex w-full items-center justify-center rounded-lg border border-violet-400/35 bg-violet-500/10 px-3 py-2 text-xs font-semibold text-violet-100 transition hover:bg-violet-500/20"
                    >
                      Review and Export
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </article>

          <article className="rounded-3xl border border-white/10 bg-white/5 p-5 shadow-sm shadow-slate-900/5 sm:p-6">
            <h3 className="text-sm font-semibold uppercase tracking-[0.14em] text-indigo-200/80">Recent Activity</h3>
            {activities.length === 0 ? (
              <p className="mt-4 rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-indigo-200/60">
                No uploads yet in this session.
              </p>
            ) : (
              <ul className="mt-4 space-y-3">
                {activities.map((item) => (
                  <li key={item.id} className="rounded-xl border border-white/10 bg-white/5 px-3 py-2.5">
                    <p className="text-sm font-medium text-indigo-100">{item.title}</p>
                    <p className="mt-1 truncate text-xs text-indigo-200/80">{item.detail}</p>
                    <p className="mt-1 text-[11px] uppercase tracking-[0.12em] text-indigo-200/50">{item.time}</p>
                  </li>
                ))}
              </ul>
            )}
          </article>
        </aside>
      </section>
    </>
  )
}
