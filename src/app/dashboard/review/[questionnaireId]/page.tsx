import { createClient } from '@/utils/supabase/server'
import { redirect } from 'next/navigation'
import QuestionnaireReviewClient from '@/components/review/QuestionnaireReviewClient'

type ReviewPageProps = {
  params: Promise<{
    questionnaireId: string
  }>
}

export default async function QuestionnaireReviewPage({ params }: ReviewPageProps) {
  const { questionnaireId } = await params

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-indigo-950 to-slate-950">
      <header className="sticky top-0 z-30 border-b border-white/10 bg-slate-950/60 backdrop-blur-xl">
        <div className="mx-auto flex w-full max-w-7xl items-center justify-between px-4 py-4 sm:px-6 lg:px-8">
          <div className="min-w-0">
            <div className="inline-flex items-center gap-2 rounded-full border border-indigo-400/40 bg-indigo-500/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-indigo-200">
              RiskFlow AI
            </div>
            <h1 className="mt-2 truncate text-lg font-semibold text-white sm:text-xl">Review and Export</h1>
          </div>

          <div className="flex items-center gap-4">
            <div className="hidden text-right sm:block">
              <p className="text-xs uppercase tracking-[0.16em] text-indigo-200/70">Signed in as</p>
              <p className="max-w-56 truncate text-sm font-medium text-indigo-100">{user.email}</p>
            </div>
            <form action="/auth/signout" method="post">
              <button
                type="submit"
                className="rounded-lg border border-rose-400/35 bg-rose-500/10 px-3 py-2 text-sm font-medium text-rose-200 transition hover:bg-rose-500/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-400/70"
              >
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 lg:px-8 lg:py-10">
        <QuestionnaireReviewClient questionnaireId={questionnaireId} />
      </main>
    </div>
  )
}
