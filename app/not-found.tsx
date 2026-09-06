import Link from "next/link";

/**
 * An unrouted URL. Kept at the root so it covers signed-out visitors and
 * mistyped tickers alike, and deliberately does not guess where the reader
 * meant to go.
 */
export default function NotFound() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-surface-page px-6 py-16 text-center">
      <span className="mb-5 block h-0.75 w-11 bg-indigo" />
      <p className="eyebrow">Not found</p>
      <h1 className="mt-1.5 font-display text-(length:--text-title) font-normal tracking-editorial text-text-strong">
        There is nothing at this address
      </h1>
      <p className="mt-2 max-w-md text-sm text-text-muted">
        The page may have moved, or the link may be wrong.
      </p>
      <Link
        href="/dashboard"
        className="mt-6 text-sm font-medium text-text-strong underline-offset-4 hover:underline"
      >
        Go to the dashboard
      </Link>
    </div>
  );
}
