import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import { getAdminContext } from "@/lib/admin/guard";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const { user, isAdmin } = await getAdminContext();
  if (!user) redirect("/login");
  // Non-admins never see the panel exists — bounce them to the dashboard.
  if (!isAdmin) redirect("/dashboard");

  return (
    <div className="min-h-dvh bg-surface-page">
      <header className="sticky top-0 z-30 border-b border-rule bg-surface-raised/95 backdrop-blur">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2.5">
            <ShieldCheck className="h-5 w-5 text-up" />
            <span className="text-sm font-semibold tracking-tight">Admin</span>
            <span className="hidden text-xs text-text-muted sm:inline">Account management</span>
          </div>
          <nav className="flex items-center gap-4">
            <Link href="/admin" className="text-xs text-text-muted hover:text-text-strong">
              Users
            </Link>
            <Link href="/admin/data-review" className="text-xs text-text-muted hover:text-text-strong">
              Data review
            </Link>
            <Link href="/admin/jobs" className="text-xs text-text-muted hover:text-text-strong">
              Jobs
            </Link>
            <Link href="/admin/beta" className="text-xs text-text-muted hover:text-text-strong">
              Beta
            </Link>
            <Link
              href="/dashboard"
              className="flex items-center gap-1.5 text-xs text-text-muted hover:text-text-strong"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Back to app
            </Link>
          </nav>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl px-4 py-6">{children}</main>
    </div>
  );
}
