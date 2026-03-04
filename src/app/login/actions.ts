'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/utils/supabase/server'

export async function login(formData: FormData) {
  const supabase = await createClient()

  const email = formData.get('email') as string
  const password = formData.get('password') as string

  const { error } = await supabase.auth.signInWithPassword({
    email,
    password,
  })

  if (error) {
    return { error: error.message }
  }

  revalidatePath('/', 'layout')
  redirect('/dashboard')
}

export async function signup(formData: FormData) {
  const supabase = await createClient()

  const email = formData.get('email') as string
  const password = formData.get('password') as string

  const { error } = await supabase.auth.signUp({
    email,
    password,
  })

  if (error) {
    const message = error.message.toLowerCase()
    const isRateLimitError =
      message.includes('email rate limit exceeded') ||
      message.includes('rate limit') ||
      message.includes('too many requests')

    if (isRateLimitError) {
      const retryAfterSeconds = extractRetryAfterSeconds(error.message)
      return {
        error: retryAfterSeconds
          ? `Signup email limit reached. Please wait about ${formatWaitTime(
            retryAfterSeconds
          )} before trying again.`
          : 'Signup email limit reached. Please wait a while before trying again.',
        retryAfterSeconds,
        rateLimited: true,
      }
    }
    return { error: error.message }
  }

  revalidatePath('/', 'layout')
  redirect('/dashboard')
}

function extractRetryAfterSeconds(errorMessage: string): number | null {
  const normalized = errorMessage.toLowerCase()

  const secondMatch = normalized.match(/(\d+)\s*second/)
  if (secondMatch) {
    return Number.parseInt(secondMatch[1], 10)
  }

  const minuteMatch = normalized.match(/(\d+)\s*minute/)
  if (minuteMatch) {
    return Number.parseInt(minuteMatch[1], 10) * 60
  }

  const hourMatch = normalized.match(/(\d+)\s*hour/)
  if (hourMatch) {
    return Number.parseInt(hourMatch[1], 10) * 3600
  }

  return null
}

function formatWaitTime(seconds: number): string {
  if (seconds < 60) return `${seconds} seconds`

  const minutes = Math.ceil(seconds / 60)
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'}`

  const hours = Math.ceil(minutes / 60)
  return `${hours} hour${hours === 1 ? '' : 's'}`
}
