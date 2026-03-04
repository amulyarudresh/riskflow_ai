import LoginForm from './LoginForm'

export default async function LoginPage({
    searchParams,
}: {
    searchParams?: Promise<{ errorMessage?: string }>
}) {
    const params = await searchParams
    return <LoginForm initialError={params?.errorMessage} />
}
