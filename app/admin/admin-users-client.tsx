"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { Loader2, UserPlus, Search, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog } from "@/components/ui/dialog";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import type { AdminUserRow } from "@/app/api/admin/users/route";

function fmtDate(s: string | null): string {
  if (!s) return "—";
  return new Date(s).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

export function AdminUsersClient() {
  const [users, setUsers] = useState<AdminUserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);

  const load = useCallback(async (q: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/users?search=${encodeURIComponent(q)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to load users");
      setUsers(data.users);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load users");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => load(search), 250);
    return () => clearTimeout(t);
  }, [search, load]);

  return (
    <div>
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative max-w-xs flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name or email"
            className="pl-9"
          />
        </div>
        <Button onClick={() => setCreateOpen(true)} className="shrink-0">
          <UserPlus className="h-4 w-4" />
          Create account
        </Button>
      </div>

      {error && (
        <p className="mb-3 rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>
      )}

      <div className="overflow-x-auto rounded-lg border border-border">
        <Table>
          <THead>
            <TR>
              <TH>User</TH>
              <TH>Status</TH>
              <TH>Joined</TH>
              <TH>Last sign-in</TH>
            </TR>
          </THead>
          <TBody>
            {loading ? (
              <TR>
                <TD colSpan={4} className="py-8 text-center text-sm text-muted-foreground">
                  <Loader2 className="mx-auto h-5 w-5 animate-spin" />
                </TD>
              </TR>
            ) : users.length === 0 ? (
              <TR>
                <TD colSpan={4} className="py-8 text-center text-sm text-muted-foreground">
                  No accounts found.
                </TD>
              </TR>
            ) : (
              users.map((u) => (
                <TR key={u.id} className="cursor-pointer hover:bg-muted/40">
                  <TD>
                    <Link href={`/admin/users/${u.id}`} className="block">
                      <span className="flex items-center gap-1.5 font-medium">
                        {u.full_name || "—"}
                        {u.is_admin && <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" />}
                      </span>
                      <span className="text-xs text-muted-foreground">{u.email}</span>
                    </Link>
                  </TD>
                  <TD>
                    <span className="flex flex-wrap gap-1">
                      {u.banned && <Badge variant="red">Suspended</Badge>}
                      {!u.onboarded && <Badge variant="amber">Onboarding</Badge>}
                      {u.demo_mode && <Badge variant="blue">Demo</Badge>}
                      {!u.banned && u.onboarded && !u.demo_mode && (
                        <Badge variant="green">Active</Badge>
                      )}
                    </span>
                  </TD>
                  <TD className="text-sm text-muted-foreground">{fmtDate(u.created_at)}</TD>
                  <TD className="text-sm text-muted-foreground">{fmtDate(u.last_sign_in_at)}</TD>
                </TR>
              ))
            )}
          </TBody>
        </Table>
      </div>

      <CreateUserDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={() => {
          setCreateOpen(false);
          load(search);
        }}
      />
    </div>
  );
}

function CreateUserDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [password, setPassword] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setEmail("");
    setFullName("");
    setPassword("");
    setIsAdmin(false);
    setError(null);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, full_name: fullName, is_admin: isAdmin }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to create account");
      reset();
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create account");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title="Create account">
      <form onSubmit={submit} className="space-y-3">
        <p className="text-xs text-muted-foreground">
          The account is ready to use immediately. Share the email and temporary password with the
          person, and ask them to change it after signing in.
        </p>
        <div className="space-y-1.5">
          <Label htmlFor="c-name">Full name</Label>
          <Input id="c-name" value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Their name" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="c-email">Email</Label>
          <Input id="c-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="them@example.com" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="c-pass">Temporary password</Label>
          <Input id="c-pass" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 8 characters" />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={isAdmin} onChange={(e) => setIsAdmin(e.target.checked)} className="h-4 w-4" />
          Grant admin access
        </label>
        {error && <p className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            Create account
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
