import { createClient, getUser } from "@/lib/supabase/server";
import { getPortfolio } from "@/lib/portfolio";
import { PageHeader } from "@/components/page-header";
import { ActionButton } from "@/components/action-button";
import {
  ProfileForm,
  FreeCashForm,
  PriceManager,
  BrokerAccounts,
  SavedMappings,
  StatementsList,
} from "@/components/settings-forms";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Download, Sparkles, Trash2, RefreshCw } from "lucide-react";
import { aiConfigured } from "@/lib/ai/openai";
import { tavilyConfigured } from "@/lib/tavily";
import { gdeltConfigured } from "@/lib/news/gdelt";
import { psxAnnouncementsConfigured } from "@/lib/news/psx-announcements";
import { twelveDataConfigured } from "@/lib/market-data/twelve-data";
import { getTaxSettings } from "@/lib/dividends/tax";
import { TaxProfileForm } from "@/components/tax-profile-form";
import type { Profile } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const supabase = await createClient();
  const user = await getUser();
  if (!user) return null;

  const taxSettings = await getTaxSettings(supabase, user.id);
  const [profileRes, accountsRes, mappingsRes, statementsRes] = await Promise.all([
    supabase.from("profiles").select("*").eq("id", user.id).maybeSingle(),
    supabase.from("broker_accounts").select("id, label, broker_type").eq("user_id", user.id).order("created_at"),
    supabase.from("import_mappings").select("id, name, statement_type, created_at").eq("user_id", user.id).order("created_at", { ascending: false }),
    supabase.from("uploaded_statements").select("id, file_name, file_type, statement_type, status, created_at").eq("user_id", user.id).order("created_at", { ascending: false }).limit(20),
  ]);
  const summary = await getPortfolio(supabase, user.id);

  const profile: Profile = profileRes.data ?? {
    id: user.id,
    full_name: "",
    base_currency: "PKR",
    cost_basis_method: "weighted_average",
    manual_price_mode: true,
    demo_mode: false,
    free_cash: 0,
  };

  const keyStatus = [
    { name: "Supabase", ok: !!process.env.NEXT_PUBLIC_SUPABASE_URL, note: "database, auth, storage" },
    { name: "Gemini", ok: aiConfigured(), note: "briefings, thesis checks, news analysis, metadata enrichment" },
    {
      name: "News providers",
      ok: tavilyConfigured() || gdeltConfigured() || psxAnnouncementsConfigured(),
      note: [
        tavilyConfigured() ? "Tavily" : null,
        gdeltConfigured() ? "GDELT" : null,
        psxAnnouncementsConfigured() ? "PSX announcements" : null,
      ].filter(Boolean).join(" + ") || "none enabled",
    },
    {
      name: "Market data",
      ok: true,
      note: `provider: ${process.env.MARKET_DATA_PROVIDER || "psx"} ${
        (process.env.MARKET_DATA_PROVIDER ?? "psx").toLowerCase().replace("-", "") === "twelvedata"
          ? twelveDataConfigured()
            ? "(Twelve Data key configured)"
            : "(Twelve Data key missing)"
          : ""
      }`,
    },
  ];
  const marketProvider = (process.env.MARKET_DATA_PROVIDER ?? "psx").toLowerCase();

  return (
    <div className="space-y-4">
      <PageHeader eyebrow="Configuration" title="Settings" description="Profile, prices, accounts, data management and integrations." />

      <Card>
        <CardHeader><CardTitle>Profile</CardTitle></CardHeader>
        <CardContent><ProfileForm profile={profile} /></CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Cash balance</CardTitle>
          <CardDescription>
            Enter your current brokerage cash balance. This is added to the cash derived from imported statements and shown as your total cash on the dashboard.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <FreeCashForm profileId={profile.id} freeCash={profile.free_cash ?? 0} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Tax profile — dividends</CardTitle>
          <CardDescription>
            Used to estimate withholding on expected dividends. Defaults to Pakistan filer / ATL. This is an estimate
            aid, not tax advice — edit the rate if FBR rules change or a dividend category is taxed differently.
          </CardDescription>
        </CardHeader>
        <CardContent><TaxProfileForm settings={taxSettings} /></CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Latest prices</CardTitle>
          <CardDescription>
            {marketProvider === "manual"
              ? "Manual provider is active: edit prices here, upload a CSV, or let statement imports capture market prices automatically."
              : `External provider is active: ${process.env.MARKET_DATA_PROVIDER || "psx"}. You can still override or backfill prices manually here.`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {summary.holdings.length === 0 ? (
            <p className="text-xs text-muted-foreground">Import holdings first; then you can manage their prices here.</p>
          ) : (
            <PriceManager
              holdings={summary.holdings.map((h) => ({
                ticker: h.ticker,
                latest_price: h.latest_price,
                price_date: h.price_date,
                price_source: h.price_source,
              }))}
            />
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Broker account labels</CardTitle>
            <CardDescription>For your own organization only.</CardDescription>
          </CardHeader>
          <CardContent><BrokerAccounts accounts={accountsRes.data ?? []} /></CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Integration status</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {keyStatus.map((k) => (
              <div key={k.name} className="flex items-center justify-between text-xs">
                <span className="font-medium">{k.name}</span>
                <span className="flex items-center gap-2 text-muted-foreground">
                  {k.note}
                  <Badge variant={k.ok ? "green" : "amber"}>{k.ok ? "configured" : "not configured"}</Badge>
                </span>
              </div>
            ))}
            <p className="pt-1 text-[11px] text-muted-foreground">
              Keys live in <code>.env.local</code> on the server. The app degrades gracefully when a key is missing.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Saved import mappings</CardTitle></CardHeader>
          <CardContent><SavedMappings mappings={mappingsRes.data ?? []} /></CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Export data</CardTitle>
            <CardDescription>Download your data as CSV anytime.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {["holdings", "transactions", "dividends", "journal"].map((k) => (
              <a key={k} href={`/api/export/${k}`}>
                <Button variant="outline" size="sm"><Download className="h-3.5 w-3.5" /> {k}</Button>
              </a>
            ))}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Uploaded statements</CardTitle>
          <CardDescription>Original files stored privately in Supabase Storage. Deleting a file keeps committed portfolio data.</CardDescription>
        </CardHeader>
        <CardContent><StatementsList statements={statementsRes.data ?? []} /></CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Demo mode</CardTitle>
          <CardDescription>
            {profile.demo_mode
              ? "Demo data is currently loaded (MEBL, FFC, HUBC, SYS, ENGRO with sample prices, theses, news and a briefing)."
              : "Load a sample PSX portfolio to try every feature, then clear it when you import real data."}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <ActionButton endpoint="/api/demo" label={<><Sparkles className="h-3.5 w-3.5" /> Load demo data</>} variant="outline" size="sm" />
          <ActionButton
            endpoint="/api/demo"
            method="DELETE"
            label={<><Trash2 className="h-3.5 w-3.5" /> Clear demo data</>}
            variant="outline"
            size="sm"
            confirmText="Remove all demo-tagged holdings, prices, news, journal entries and briefings?"
          />
        </CardContent>
      </Card>

      <Card className="border-red-200">
        <CardHeader>
          <CardTitle className="text-red-700">Danger zone</CardTitle>
          <CardDescription>Reset deletes ALL portfolio data and uploaded files for your account. This cannot be undone.</CardDescription>
        </CardHeader>
        <CardContent>
          <ActionButton
            endpoint="/api/portfolio/reset"
            body={{ confirm: "RESET" }}
            label={<><RefreshCw className="h-3.5 w-3.5" /> Reset portfolio</>}
            variant="destructive"
            size="sm"
            confirmText="This permanently deletes all holdings, transactions, news, briefings, journal entries, alerts and uploaded statements. Continue?"
          />
        </CardContent>
      </Card>
    </div>
  );
}
