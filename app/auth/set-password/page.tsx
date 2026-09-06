"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * The first screen an invited user sees after opening the email link. The
 * session already exists (see /auth/callback); this sets the password they
 * will sign in with from now on, then continues to onboarding.
 */
export default function SetPasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 8) return setError("Use at least 8 characters.");
    if (password !== confirm) return setError("The two passwords do not match.");
    setSaving(true);
    const supabase = createClient();
    const { data: session } = await supabase.auth.getUser();
    if (!session.user) {
      setSaving(false);
      return setError("Your invite link has expired. Ask for a new one.");
    }
    const { error: updateError } = await supabase.auth.updateUser({ password });
    setSaving(false);
    if (updateError) return setError(updateError.message);
    router.push("/onboarding");
    router.refresh();
  }

  return (
    <main className="flex min-h-dvh items-center justify-center bg-surface-page px-4">
      <form onSubmit={submit} className="w-full max-w-sm">
        <span className="mb-4 block h-0.75 w-11 bg-indigo" />
        <h1 className="font-display text-2xl font-normal tracking-editorial text-text-strong">Choose a password</h1>
        <p className="mt-2 text-sm text-text-muted">You are signed in from your invite. Set the password you will use from now on.</p>
        <div className="mt-6 space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="password">Password</Label>
            <Input id="password" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="confirm">Confirm password</Label>
            <Input id="confirm" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          </div>
        </div>
        {error && <p className="mt-4 text-xs text-down">{error}</p>}
        <Button type="submit" className="mt-6 w-full" disabled={saving}>
          {saving ? "Saving" : "Continue"}
        </Button>
      </form>
    </main>
  );
}
