import { redirect } from "next/navigation";
import { createClient, getUser } from "@/lib/supabase/server";
import { OnboardingWizard, OnboardingBrand } from "@/components/onboarding-wizard";
import { DISCLAIMER } from "@/lib/utils";
import type { ExperienceLevel } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function OnboardingPage() {
  const user = await getUser();
  if (!user) redirect("/login");

  const supabase = await createClient();
  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, onboarded, experience_level")
    .eq("id", user.id)
    .maybeSingle();

  // Already set up: send them straight into the app.
  if (profile?.onboarded) redirect("/dashboard");

  return (
    <main className="relative flex min-h-dvh flex-col items-center bg-background px-4 py-[calc(2.5rem+env(safe-area-inset-top))]">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 80% 50% at 50% 0%, rgba(16,185,129,0.08) 0%, transparent 70%)",
        }}
      />
      <div className="relative z-10 flex w-full max-w-lg flex-col items-center pt-6 sm:pt-12">
        <OnboardingBrand />
        <OnboardingWizard
          initialName={profile?.full_name ?? ""}
          initialExperience={(profile?.experience_level as ExperienceLevel) ?? "intermediate"}
        />
      </div>
      <p className="relative z-10 mt-10 max-w-sm px-4 text-center text-[11px] text-muted-foreground">{DISCLAIMER}</p>
    </main>
  );
}
