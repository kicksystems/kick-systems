import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/auth";

async function setPassword(formData: FormData) {
  "use server";
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");
  if (password.length < 10 || password !== confirm) redirect("/auth/set-password?error=1");
  const supabase = await supabaseServer();
  const { error } = await supabase.auth.updateUser({ password });
  if (error) redirect("/auth/set-password?error=1");
  redirect("/");
}

export default async function SetPassword({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  return (
    <main className="min-h-dvh grid place-items-center px-4">
      <form action={setPassword} className="card p-5 w-full max-w-sm space-y-3">
        <p className="font-display text-2xl font-bold text-accent">Choose your password</p>
        {sp.error && <p role="alert" className="text-sm text-danger">Use at least 10 characters and type the same password twice.</p>}
        <label className="block"><span className="label">New password</span>
          <input className="input mt-1" name="password" type="password" autoComplete="new-password" minLength={10} required /></label>
        <label className="block"><span className="label">Type it again</span>
          <input className="input mt-1" name="confirm" type="password" autoComplete="new-password" minLength={10} required /></label>
        <button className="btn w-full justify-center">Save and enter</button>
      </form>
    </main>
  );
}
