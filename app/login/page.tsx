import { login } from "../actions";
import { SubmitButton } from "@/components/SubmitButton";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <form action={login} className="card w-full max-w-sm p-8">
        <h1 className="font-serif text-3xl">PitchDesk</h1>
        <p className="mt-1 mb-6 text-sm text-muted">Podcast outreach for The AI Boss</p>
        <label className="label" htmlFor="password">
          Password
        </label>
        <input id="password" name="password" type="password" className="input" autoFocus required />
        {error && <p className="mt-2 text-sm text-bad">Wrong password.</p>}
        <SubmitButton className="btn-primary mt-5 w-full" pendingText="Signing in…">
          Sign in
        </SubmitButton>
      </form>
    </main>
  );
}
