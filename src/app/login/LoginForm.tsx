'use client'

import { useEffect, useMemo, useState, useTransition } from 'react'
import { login, signup } from './actions'

const SIGNUP_COOLDOWN_SECONDS = 60
const SIGNUP_COOLDOWN_STORAGE_KEY = 'riskflow_signup_cooldown_expires_at'

export default function LoginForm({ initialError }: { initialError?: string }) {
    const [isPendingLogin, startLoginTransition] = useTransition()
    const [isPendingSignup, startSignupTransition] = useTransition()
    const [error, setError] = useState(initialError || '')
    const [signupCooldownSecondsLeft, setSignupCooldownSecondsLeft] = useState(0)

    const isLoading = isPendingLogin || isPendingSignup
    const remainingCooldownSeconds = useMemo(
        () => Math.max(0, signupCooldownSecondsLeft),
        [signupCooldownSecondsLeft]
    )
    const isSignupCoolingDown = remainingCooldownSeconds > 0

    useEffect(() => {
        const storedCooldown = window.localStorage.getItem(SIGNUP_COOLDOWN_STORAGE_KEY)
        if (!storedCooldown) return

        const expiresAt = Number.parseInt(storedCooldown, 10)
        if (Number.isNaN(expiresAt)) {
            window.localStorage.removeItem(SIGNUP_COOLDOWN_STORAGE_KEY)
            return
        }

        const secondsLeft = Math.ceil((expiresAt - Date.now()) / 1000)
        if (secondsLeft > 0) {
            const timer = setTimeout(() => {
                setSignupCooldownSecondsLeft(secondsLeft)
            }, 0)
            return () => clearTimeout(timer)
        } else {
            window.localStorage.removeItem(SIGNUP_COOLDOWN_STORAGE_KEY)
        }
    }, [])

    useEffect(() => {
        if (!isSignupCoolingDown) return
        const timer = setTimeout(() => {
            setSignupCooldownSecondsLeft((prev) => Math.max(0, prev - 1))
        }, 1000)
        return () => clearTimeout(timer)
    }, [isSignupCoolingDown, signupCooldownSecondsLeft])

    useEffect(() => {
        if (signupCooldownSecondsLeft > 0) return
        window.localStorage.removeItem(SIGNUP_COOLDOWN_STORAGE_KEY)
    }, [signupCooldownSecondsLeft])

    const startSignupCooldown = (seconds: number) => {
        const duration = Math.max(1, seconds)
        setSignupCooldownSecondsLeft(duration)
        const expiresAt = Date.now() + duration * 1000
        window.localStorage.setItem(SIGNUP_COOLDOWN_STORAGE_KEY, String(expiresAt))
    }

    const handleLogin = (formData: FormData) => {
        setError('')
        startLoginTransition(async () => {
            const result = await login(formData)
            if (result?.error) {
                setError(result.error)
            }
        })
    }

    const handleSignup = (formData: FormData) => {
        if (isSignupCoolingDown) return

        setError('')
        startSignupTransition(async () => {
            const result = await signup(formData)
            if (result?.error) {
                if (result.rateLimited || result.error.toLowerCase().includes('rate limit')) {
                    const cooldownSeconds =
                        typeof result.retryAfterSeconds === 'number' && result.retryAfterSeconds > 0
                            ? result.retryAfterSeconds
                            : SIGNUP_COOLDOWN_SECONDS

                    startSignupCooldown(cooldownSeconds)
                    setError(result.error)
                    return
                }
                setError(result.error)
            }
        })
    }

    return (
        <div className="flex h-screen w-full items-center justify-center bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-900 relative overflow-hidden">
            {/* Decorative background */}
            <div className="absolute inset-0 overflow-hidden pointer-events-none">
                <div className="absolute -top-40 -right-40 w-96 h-96 rounded-full bg-indigo-500/10 blur-3xl animate-pulse" />
                <div className="absolute -bottom-40 -left-40 w-96 h-96 rounded-full bg-violet-500/10 blur-3xl animate-pulse [animation-delay:1s]" />
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full bg-indigo-600/5 blur-3xl" />
            </div>

            <div className="relative z-10 w-full max-w-md px-4">
                {/* Logo */}
                <div className="text-center mb-8">
                    <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-indigo-600 mb-4 shadow-lg shadow-indigo-500/30">
                        <svg className="w-7 h-7 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                        </svg>
                    </div>
                    <h1 className="text-3xl font-bold text-white tracking-tight">RiskFlow AI</h1>
                    <p className="text-indigo-200/60 mt-2 text-sm">Intelligent questionnaire answering, powered by your data.</p>
                </div>

                {/* Card */}
                <div className="rounded-2xl border border-white/10 bg-white/5 backdrop-blur-xl shadow-2xl p-8">
                    <h2 className="text-lg font-semibold text-white mb-6">Sign in to your account</h2>

                    <form className="flex flex-col gap-5">
                        <div>
                            <label className="block text-sm font-medium text-indigo-200/80 mb-1.5" htmlFor="email">Email address</label>
                            <input
                                id="email"
                                name="email"
                                type="email"
                                required
                                disabled={isLoading}
                                className="block w-full rounded-lg border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-white placeholder:text-white/30 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/40 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                                placeholder="you@example.com"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-indigo-200/80 mb-1.5" htmlFor="password">Password</label>
                            <input
                                id="password"
                                name="password"
                                type="password"
                                required
                                disabled={isLoading}
                                className="block w-full rounded-lg border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-white placeholder:text-white/30 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/40 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                                placeholder="••••••••"
                            />
                        </div>

                        {/* Error display */}
                        {error && (
                            <div className="flex items-start gap-2.5 text-sm text-red-300 bg-red-500/10 border border-red-500/20 p-3 rounded-lg animate-[fadeIn_0.3s_ease-out]">
                                <svg className="w-4 h-4 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                </svg>
                                <span>{error}</span>
                            </div>
                        )}

                        <div className="flex flex-col gap-3 mt-1">
                            <button
                                formAction={handleLogin}
                                disabled={isLoading}
                                className="relative w-full rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-indigo-500/25 hover:bg-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 focus:ring-offset-slate-900 transition-all duration-200 cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed disabled:hover:bg-indigo-600"
                            >
                                <span className={isPendingLogin ? 'invisible' : ''}>Sign in</span>
                                {isPendingLogin && (
                                    <div className="absolute inset-0 flex items-center justify-center gap-2">
                                        <Spinner />
                                        <span className="text-sm">Signing in...</span>
                                    </div>
                                )}
                            </button>

                            <div className="relative flex items-center justify-center my-1">
                                <div className="absolute inset-0 flex items-center">
                                    <div className="w-full border-t border-white/10" />
                                </div>
                                <span className="relative bg-transparent px-3 text-xs text-white/30">or</span>
                            </div>

                            <button
                                formAction={handleSignup}
                                disabled={isLoading || isSignupCoolingDown}
                                className="relative w-full rounded-lg border border-white/15 bg-white/5 px-4 py-2.5 text-sm font-semibold text-white hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 focus:ring-offset-slate-900 transition-all duration-200 cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed disabled:hover:bg-white/5"
                            >
                                <span className={isPendingSignup ? 'invisible' : ''}>
                                    {isSignupCoolingDown ? `Retry in ${remainingCooldownSeconds}s` : 'Create account'}
                                </span>
                                {isPendingSignup && (
                                    <div className="absolute inset-0 flex items-center justify-center gap-2">
                                        <Spinner />
                                        <span className="text-sm">Creating account...</span>
                                    </div>
                                )}
                            </button>
                            {isSignupCoolingDown && (
                                <p className="text-xs text-amber-200/80 text-center">
                                    Signup is temporarily paused to avoid email rate limits.
                                </p>
                            )}
                        </div>
                    </form>
                </div>

                <p className="text-center text-xs text-white/20 mt-6">
                    Structured Questionnaire Answering Tool &middot; v0.1
                </p>
            </div>
        </div>
    )
}

function Spinner() {
    return (
        <svg className="animate-spin h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
        </svg>
    )
}
