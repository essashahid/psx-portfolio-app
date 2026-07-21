import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

/**
 * The plain-language companion to the Outlook tab.
 *
 * Written for a reader who does not want tables: what this feature is, what it
 * is allowed to say, where its information comes from, and what it still
 * cannot do. Every claim here is a restatement of the committed evaluation
 * artifacts in words; nothing is computed on this page and no live forecast
 * values appear. The full workings live on the research page for anyone who
 * wants them.
 */

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardContent className="p-4">
        <h2 className="text-sm font-semibold tracking-editorial text-foreground">{title}</h2>
        <div className="mt-2 space-y-2 text-xs leading-relaxed text-muted-foreground">{children}</div>
      </CardContent>
    </Card>
  );
}

export function AboutDataView() {
  return (
    <div className="space-y-4">
      <Card className="rise border-l-[3px] border-l-brand">
        <CardContent className="p-4">
          <p className="eyebrow mb-1.5">In plain words</p>
          <p className="text-sm leading-relaxed text-foreground">
            The Market Outlook studies how the Pakistani stock market has behaved and is being built into a careful
            early-warning system. It follows one rule throughout: nothing is shown unless it proved itself on history it
            had never seen. Anything that failed that test is left out, on purpose.
          </p>
        </CardContent>
      </Card>

      <div className="rise rise-1 space-y-4">
        <Section title="What it can say, and what it cannot">
          <p>
            Testing found a few things the data genuinely supports. How far the market typically travels over a week,
            two weeks or a month. The chance of a quick 3% dip in the days ahead, which rises when the market has been
            turbulent. And a modest lean on which way the next two weeks tilt.
          </p>
          <p>
            Just as important is what failed. No model could predict the exact size of a move, and precise price
            targets were no better than simple history. Those are withheld rather than dressed up, because a confident
            number that has not earned its confidence is worse than no number.
          </p>
        </Section>

        <Section title="Where the information comes from">
          <p>
            Five years of daily history for the KSE-100 and the other main indices, prices for every listed company,
            how many stocks rise or fall each day, foreign investor buying and selling, the rupee, gold, oil, global
            markets, interest rates and inflation. Everything is dated the way it was actually published, so no reading
            ever uses information that was not available at the time.
          </p>
        </Section>

        <Section title="What it still cannot see">
          <p>
            History before 2021 is not available from the exchange, so every conclusion rests on the past five years.
            News, politics and world events are not yet inputs. And no forecast, however careful, removes the risk of
            surprises the past has never shown.
          </p>
        </Section>
      </div>

      <Card className="rise rise-2">
        <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-sm font-semibold tracking-editorial text-foreground">Want the full workings?</h2>
            <p className="mt-1 max-w-xl text-xs leading-relaxed text-muted-foreground">
              Every test, every number and every failed idea is kept in the open: the signal research, the model
              evaluation, and an experimental preview of the outlook under review.
            </p>
          </div>
          <Link
            href="/outlook/research"
            className="inline-flex min-h-9 shrink-0 items-center gap-1.5 self-start rounded-md border border-border px-3 text-[13px] font-medium text-foreground transition-colors duration-(--dur-fast) ease-(--ease-ui) hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-card sm:self-auto"
          >
            Research workbench
            <ArrowRight aria-hidden className="h-3.5 w-3.5" />
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
