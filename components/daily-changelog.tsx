import { Sparkles } from "lucide-react";

export interface ChangelogRow {
  run_date: string;
  highlights: string[];
}

/** "What changed since yesterday" — the latest daily-update digest. */
export function DailyChangelog({ changelog, today }: { changelog: ChangelogRow | null; today: string }) {
  if (!changelog || changelog.highlights.length === 0) return null;
  const isToday = changelog.run_date === today;
  const onlyNoActivity =
    changelog.highlights.length === 1 && /no new dividend activity/i.test(changelog.highlights[0]);
  if (onlyNoActivity) return null;

  return (
    <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 dark:border-blue-900 dark:bg-blue-950/40">
      <div className="flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-blue-600" />
        <p className="text-xs font-semibold text-blue-900 dark:text-blue-200">
          What changed {isToday ? "today" : `on ${changelog.run_date}`}
        </p>
      </div>
      <ul className="mt-1.5 grid gap-1 md:grid-cols-2">
        {changelog.highlights.map((h, i) => (
          <li key={i} className="flex items-start gap-1.5 text-xs text-blue-900/90 dark:text-blue-200/90">
            <span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-blue-500" />
            {h}
          </li>
        ))}
      </ul>
    </div>
  );
}
