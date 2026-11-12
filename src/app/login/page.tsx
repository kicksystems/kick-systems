import { AUTH_MODE } from "@/lib/auth";
import { pool } from "@/lib/db";
import { devLogin, forgotPassword, passwordLogin } from "./actions";

const ERRORS: Record<string, string> = {
  credentials: "Wrong e-mail or password.",
  inactive: "This account is not active. Talk to an admin.",
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  const error = sp.error ? ERRORS[sp.error] : null;

  return (
    <main className="min-h-dvh grid place-items-center px-4 py-10">
      <div className="w-full max-w-sm">
        <p className="font-display text-3xl font-bold text-accent">Kick Systems</p>
        <p className="text-muted text-sm mb-6">Production management · Kick Pictures</p>

        {error && <p role="alert" className="card px-4 py-3 mb-4 text-sm text-danger">{error}</p>}
        {sp.sent && <p className="card px-4 py-3 mb-4 text-sm">If that e-mail has an account, a reset link is on its way.</p>}

        {AUTH_MODE === "dev" ? <DevPicker /> : (
          <div className="card p-5 space-y-5">
            <form action={passwordLogin} className="space-y-3">
              <label className="block"><span className="label">E-mail</span>
                <input className="input mt-1" name="email" type="email" autoComplete="email" required /></label>
              <label className="block"><span className="label">Password</span>
                <input className="input mt-1" name="password" type="password" autoComplete="current-password" required /></label>
              <button className="btn w-full justify-center">Log in</button>
            </form>
            <details className="text-sm">
              <summary className="cursor-pointer text-muted">Forgot your password?</summary>
              <form action={forgotPassword} className="mt-3 flex gap-2">
                <input className="input" name="email" type="email" placeholder="Your e-mail" required />
                <button className="btn btn-ghost shrink-0">Send link</button>
              </form>
            </details>
          </div>
        )}
      </div>
    </main>
  );
}

async function DevPicker() {
  const { rows } = await pool.query(
    "select id, full_name, user_type from profiles where is_active order by user_type, full_name");
  return (
    <div className="card p-5">
      <p className="text-sm mb-1 font-semibold">Local test mode</p>
      <p className="text-xs text-muted mb-4">Pick who you want to be. This screen does not exist online, where everyone logs in with e-mail and password.</p>
      <form action={devLogin} className="space-y-2">
        {rows.map((u) => (
          <button key={u.id} name="userId" value={u.id}
            className="w-full flex justify-between items-center rounded-xl border border-line px-3 py-2 text-sm hover:border-accent bg-white">
            <span>{u.full_name}</span><span className="chip">{u.user_type}</span>
          </button>
        ))}
      </form>
    </div>
  );
}
