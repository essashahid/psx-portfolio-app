"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Loader2, KeyRound, Ban, Trash2, ShieldCheck, Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select } from "@/components/ui/select";
import { Dialog } from "@/components/ui/dialog";
import { Card } from "@/components/ui/card";
import { NAV } from "@/lib/nav";
import {
  ACCOUNT_CAPABILITIES,
  ALL_ACCOUNT_FEATURES,
  CHAT_PROVIDERS,
  LAUNCH_DEFAULT_FEATURES,
  type ChatProvider,
} from "@/lib/features";

type Detail = {
  auth: {
    id: string;
    email: string;
    created_at: string;
    last_sign_in_at: string | null;
    email_confirmed_at: string | null;
    banned: boolean;
  };
  profile: {
    full_name: string | null;
    is_admin: boolean;
    onboarded: boolean;
    demo_mode: boolean;
    base_currency: string;
    experience_level: string;
    enabled_features: string[];
    allowed_llm_providers: ChatProvider[];
  } | null;
  summary: { holdings: number; transactions: number; dividends: number; cash: number };
  holdings: Array<{
    ticker: string;
    company_name: string | null;
    quantity: number;
    avg_cost: number;
    total_cost: number;
  }>;
};

function fmtDate(s: string | null): string {
  if (!s) return "—";
  return new Date(s).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function UserDetailClient({ userId }: { userId: string }) {
  const router = useRouter();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Editable profile fields
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [experience, setExperience] = useState("intermediate");
  const [baseCurrency, setBaseCurrency] = useState("PKR");
  const [isAdmin, setIsAdmin] = useState(false);
  const [onboarded, setOnboarded] = useState(false);
  const [demoMode, setDemoMode] = useState(false);
  const [enabledFeatures, setEnabledFeatures] = useState<Set<string>>(() => new Set(LAUNCH_DEFAULT_FEATURES));
  const [allowedLlm, setAllowedLlm] = useState<Set<ChatProvider>>(() => new Set(CHAT_PROVIDERS));
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  const [pwOpen, setPwOpen] = useState(false);
  const [delOpen, setDelOpen] = useState(false);
  const [viewingAs, setViewingAs] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/users/${userId}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to load user");
      const d = data as Detail;
      setDetail(d);
      setEmail(d.auth.email);
      setFullName(d.profile?.full_name ?? "");
      setExperience(d.profile?.experience_level ?? "intermediate");
      setBaseCurrency(d.profile?.base_currency ?? "PKR");
      setIsAdmin(Boolean(d.profile?.is_admin));
      setOnboarded(Boolean(d.profile?.onboarded));
      setDemoMode(Boolean(d.profile?.demo_mode));
      setEnabledFeatures(new Set(d.profile?.enabled_features?.length ? d.profile.enabled_features : LAUNCH_DEFAULT_FEATURES));
      setAllowedLlm(new Set(d.profile?.allowed_llm_providers ?? CHAT_PROVIDERS));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load user");
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    const t = setTimeout(() => load(), 0);
    return () => clearTimeout(t);
  }, [load]);

  async function saveProfile(e?: React.FormEvent) {
    e?.preventDefault();
    setSaving(true);
    setError(null);
    setSavedMsg(null);
    try {
      const res = await fetch(`/api/admin/users/${userId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          full_name: fullName,
          experience_level: experience,
          base_currency: baseCurrency,
          is_admin: isAdmin,
          onboarded,
          demo_mode: demoMode,
          enabled_features: [...enabledFeatures],
          allowed_llm_providers: [...allowedLlm],
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to save");
      setSavedMsg("Changes saved.");
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  function toggleFeature(href: string) {
    if (href === "/dashboard") return;
    setEnabledFeatures((prev) => {
      const next = new Set(prev);
      if (next.has(href)) next.delete(href);
      else next.add(href);
      next.add("/dashboard");
      return next;
    });
  }

  function toggleProvider(provider: ChatProvider) {
    setAllowedLlm((prev) => {
      const next = new Set(prev);
      if (next.has(provider)) next.delete(provider);
      else next.add(provider);
      return next;
    });
  }

  function capabilityLabel(capability: string) {
    if (capability === "company_enrichment") return "Update company details";
    if (capability === "company_reports") return "Company reports and AI analysis";
    return capability;
  }

  function capabilityHint(capability: string) {
    if (capability === "company_enrichment") return "Allows AI-backed company profile and holdings metadata updates.";
    if (capability === "company_reports") return "Allows company report generation and stock detail AI analysis.";
    return "Account capability.";
  }

  async function toggleBan() {
    if (!detail) return;
    setError(null);
    try {
      const res = await fetch(`/api/admin/users/${userId}/ban`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ banned: !detail.auth.banned }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to update");
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update");
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (error && !detail) {
    return (
      <div>
        <BackLink />
        <p className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      </div>
    );
  }
  if (!detail) return null;

  return (
    <div className="space-y-5">
      <BackLink />

      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-xl font-semibold tracking-tight">{detail.profile?.full_name || detail.auth.email}</h1>
        {detail.profile?.is_admin && (
          <Badge variant="green" className="gap-1">
            <ShieldCheck className="h-3 w-3" /> Admin
          </Badge>
        )}
        {detail.auth.banned && <Badge variant="red">Suspended</Badge>}
      </div>

      <div className="grid gap-4 sm:grid-cols-4">
        <Stat label="Holdings" value={detail.summary.holdings} />
        <Stat label="Transactions" value={detail.summary.transactions} />
        <Stat label="Dividends" value={detail.summary.dividends} />
        <Stat label="Cash moves" value={detail.summary.cash} />
      </div>

      <Card className="p-4">
        <h2 className="mb-1 text-sm font-semibold">Account</h2>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
          <dt className="text-muted-foreground">Joined</dt>
          <dd>{fmtDate(detail.auth.created_at)}</dd>
          <dt className="text-muted-foreground">Last sign-in</dt>
          <dd>{fmtDate(detail.auth.last_sign_in_at)}</dd>
          <dt className="text-muted-foreground">Email confirmed</dt>
          <dd>{detail.auth.email_confirmed_at ? "Yes" : "No"}</dd>
          <dt className="text-muted-foreground">User ID</dt>
          <dd className="truncate font-mono">{detail.auth.id}</dd>
        </dl>
      </Card>

      <Card className="p-4">
        <h2 className="mb-3 text-sm font-semibold">Edit profile</h2>
        <form onSubmit={saveProfile} className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="d-name">Full name</Label>
              <Input id="d-name" value={fullName} onChange={(e) => setFullName(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="d-email">Email</Label>
              <Input id="d-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="d-exp">Experience level</Label>
              <Select id="d-exp" value={experience} onChange={(e) => setExperience(e.target.value)}>
                <option value="beginner">Beginner</option>
                <option value="intermediate">Intermediate</option>
                <option value="advanced">Advanced</option>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="d-cur">Base currency</Label>
              <Input id="d-cur" value={baseCurrency} onChange={(e) => setBaseCurrency(e.target.value)} />
            </div>
          </div>
          <div className="flex flex-wrap gap-4 pt-1">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={isAdmin} onChange={(e) => setIsAdmin(e.target.checked)} className="h-4 w-4" />
              Admin access
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={onboarded} onChange={(e) => setOnboarded(e.target.checked)} className="h-4 w-4" />
              Onboarded
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={demoMode} onChange={(e) => setDemoMode(e.target.checked)} className="h-4 w-4" />
              Demo mode
            </label>
          </div>
          {error && <p className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}
          {savedMsg && <p className="rounded-md bg-emerald-50 px-3 py-2 text-xs text-emerald-700">{savedMsg}</p>}
          <div className="flex justify-end">
            <Button type="submit" disabled={saving}>
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              Save changes
            </Button>
          </div>
        </form>
      </Card>

      <Card className="p-4">
        <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold">Feature access</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Account-level tabs and Research Copilot model providers. Admin-only tools still require admin access.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setEnabledFeatures(new Set(LAUNCH_DEFAULT_FEATURES))}
            >
              Launch default
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setEnabledFeatures(new Set(ALL_ACCOUNT_FEATURES))}
            >
              Enable everything
            </Button>
          </div>
        </div>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {NAV.map((item) => {
            const checked = enabledFeatures.has(item.href) || item.href === "/dashboard";
            return (
              <label
                key={item.href}
                className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-border bg-card px-3 py-2 text-xs"
              >
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={item.href === "/dashboard"}
                  onChange={() => toggleFeature(item.href)}
                  className="mt-0.5 h-4 w-4 accent-emerald-600 disabled:opacity-60"
                />
                <span className="min-w-0">
                  <span className="flex items-center gap-1.5 font-medium">
                    {item.label}
                    {item.adminOnly && <Badge variant="amber">Admin</Badge>}
                  </span>
                  <span className="mt-0.5 block leading-relaxed text-muted-foreground">{item.hint}</span>
                </span>
              </label>
            );
          })}
        </div>
        <div className="mt-4 border-t border-border pt-4">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">AI and report capabilities</h3>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {ACCOUNT_CAPABILITIES.map((capability) => (
              <label
                key={capability}
                className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-border bg-card px-3 py-2 text-xs"
              >
                <input
                  type="checkbox"
                  checked={enabledFeatures.has(capability)}
                  onChange={() => toggleFeature(capability)}
                  className="mt-0.5 h-4 w-4 accent-emerald-600"
                />
                <span>
                  <span className="font-medium">{capabilityLabel(capability)}</span>
                  <span className="mt-0.5 block leading-relaxed text-muted-foreground">{capabilityHint(capability)}</span>
                </span>
              </label>
            ))}
          </div>
        </div>
        <div className="mt-4 border-t border-border pt-4">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Research Copilot models</h3>
          <div className="mt-2 flex flex-wrap gap-3">
            {CHAT_PROVIDERS.map((provider) => (
              <label key={provider} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={allowedLlm.has(provider)}
                  onChange={() => toggleProvider(provider)}
                  className="h-4 w-4 accent-emerald-600"
                />
                {provider === "claude" ? "Claude" : "DeepSeek"}
              </label>
            ))}
          </div>
        </div>
        {(error || savedMsg) && (
          <p className={`mt-4 rounded-md px-3 py-2 text-xs ${error ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-700"}`}>
            {error ?? savedMsg}
          </p>
        )}
        <div className="mt-4 flex justify-end">
          <Button type="button" onClick={() => void saveProfile()} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            Save access
          </Button>
        </div>
      </Card>

      {detail.holdings.length > 0 && (
        <Card className="p-4">
          <h2 className="mb-3 text-sm font-semibold">Holdings ({detail.holdings.length})</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted-foreground">
                  <th className="py-1.5 pr-3 font-medium">Ticker</th>
                  <th className="py-1.5 pr-3 font-medium">Qty</th>
                  <th className="py-1.5 pr-3 font-medium">Avg cost</th>
                  <th className="py-1.5 font-medium">Total cost</th>
                </tr>
              </thead>
              <tbody>
                {detail.holdings.map((h) => (
                  <tr key={h.ticker} className="border-b border-border/50 last:border-0">
                    <td className="py-1.5 pr-3 font-medium">{h.ticker}</td>
                    <td className="py-1.5 pr-3">{h.quantity}</td>
                    <td className="py-1.5 pr-3">{h.avg_cost.toLocaleString()}</td>
                    <td className="py-1.5">{h.total_cost.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Card className="border-amber-200 bg-amber-50/40 p-4">
        <h2 className="mb-1 text-sm font-semibold">Account actions</h2>
        <p className="mb-3 text-xs text-muted-foreground">
          Reset the password, suspend sign-in access, or permanently delete the account.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            onClick={async () => {
              setViewingAs(true);
              try {
                const res = await fetch("/api/admin/impersonate", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ userId }),
                });
                if (!res.ok) {
                  const d = await res.json();
                  setError(d.error ?? "Failed to switch view");
                  return;
                }
                router.push("/dashboard");
                router.refresh();
              } finally {
                setViewingAs(false);
              }
            }}
            disabled={viewingAs}
          >
            {viewingAs ? <Loader2 className="h-4 w-4 animate-spin" /> : <Eye className="h-4 w-4" />}
            View as this user
          </Button>
          <Button variant="outline" onClick={() => setPwOpen(true)}>
            <KeyRound className="h-4 w-4" />
            Set password
          </Button>
          <Button variant="outline" onClick={toggleBan}>
            <Ban className="h-4 w-4" />
            {detail.auth.banned ? "Restore access" : "Suspend"}
          </Button>
          <Button variant="destructive" onClick={() => setDelOpen(true)}>
            <Trash2 className="h-4 w-4" />
            Delete account
          </Button>
        </div>
      </Card>

      <SetPasswordDialog userId={userId} open={pwOpen} onClose={() => setPwOpen(false)} />
      <DeleteDialog
        open={delOpen}
        onClose={() => setDelOpen(false)}
        email={detail.auth.email}
        userId={userId}
        onDeleted={() => router.push("/admin")}
      />
    </div>
  );
}

function BackLink() {
  return (
    <Link href="/admin" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
      <ArrowLeft className="h-3.5 w-3.5" />
      All users
    </Link>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <Card className="p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-lg font-semibold tabular-nums">{value.toLocaleString()}</p>
    </Card>
  );
}

function SetPasswordDialog({ userId, open, onClose }: { userId: string; open: boolean; onClose: () => void }) {
  const [password, setPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/users/${userId}/password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to set password");
      setDone(true);
      setPassword("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to set password");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title="Set new password">
      {done ? (
        <div className="space-y-3">
          <p className="text-sm">Password updated. Share the new password with the user.</p>
          <div className="flex justify-end">
            <Button onClick={() => { setDone(false); onClose(); }}>Done</Button>
          </div>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="p-pass">New password</Label>
            <Input id="p-pass" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 8 characters" />
          </div>
          {error && <p className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={saving}>
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              Set password
            </Button>
          </div>
        </form>
      )}
    </Dialog>
  );
}

function DeleteDialog({
  open,
  onClose,
  email,
  userId,
  onDeleted,
}: {
  open: boolean;
  onClose: () => void;
  email: string;
  userId: string;
  onDeleted: () => void;
}) {
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function del() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/users/${userId}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to delete");
      onDeleted();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete");
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title="Delete account">
      <div className="space-y-3">
        <p className="text-sm">
          This permanently deletes <span className="font-medium">{email}</span> and all of their
          portfolio data. This cannot be undone.
        </p>
        <div className="space-y-1.5">
          <Label htmlFor="del-confirm">Type the email to confirm</Label>
          <Input id="del-confirm" value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder={email} />
        </div>
        {error && <p className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="destructive" disabled={confirm !== email || saving} onClick={del}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            Delete permanently
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
