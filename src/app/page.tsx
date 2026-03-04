import Link from "next/link";

export default function Home() {
  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-900 px-6">
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -top-36 -right-28 h-80 w-80 rounded-full bg-indigo-500/15 blur-3xl" />
        <div className="absolute -bottom-44 -left-24 h-96 w-96 rounded-full bg-violet-500/15 blur-3xl" />
      </div>

      <main className="relative z-10 w-full max-w-2xl rounded-3xl border border-white/10 bg-white/5 p-8 text-center shadow-2xl backdrop-blur-xl sm:p-10">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-indigo-200/80">RiskFlow AI</p>
        <h1 className="mt-3 text-3xl font-bold tracking-tight text-white sm:text-4xl">
          Structured questionnaire intelligence
        </h1>
        <p className="mt-4 text-sm leading-6 text-indigo-100/80 sm:text-base">
          Securely ingest compliance evidence and questionnaire files, then generate grounded responses from your own
          policy context.
        </p>

        <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:justify-center">
          <Link
            href="/login"
            className="rounded-xl bg-indigo-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-indigo-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400/80"
          >
            Go to Login
          </Link>
          <Link
            href="/dashboard"
            className="rounded-xl border border-white/20 bg-white/5 px-5 py-3 text-sm font-semibold text-indigo-100 transition hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300/70"
          >
            Open Dashboard
          </Link>
        </div>
      </main>
    </div>
  )
}
