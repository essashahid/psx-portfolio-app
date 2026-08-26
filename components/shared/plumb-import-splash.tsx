"use client";

/**
 * The import variant of the launch sequence: paper field, line only, no
 * wordmark, and a status line naming the operation actually running.
 *
 * Separate from PlumbSplash on purpose. That one is an entrance and always
 * lasts 1180ms; this one covers work whose length nobody knows, so it stays up
 * exactly as long as the work does and says what the work is.
 *
 * `stage` must be the real operation, never a generic "Loading…". If the caller
 * cannot name what is happening, the honest answer is an inline spinner rather
 * than a full-screen panel implying a pipeline.
 *
 * NOTE: the design brief describes a four-stage pipeline (parsed, matched,
 * pricing, reconciling) with per-stage counts. Those stages do not exist in
 * this codebase: import is three discrete user-driven requests (upload, remap,
 * commit), each a single blocking call with no progress to report. `stage` and
 * `detail` therefore take whatever the caller genuinely knows. When a staged
 * importer lands, it feeds them here without changing this component.
 */
export function PlumbImportSplash({
  stage,
  detail,
  /** e.g. "Five rows need your eyes — uncertain rows are never silently applied." */
  note,
}: {
  stage: string;
  detail?: string;
  note?: string;
}) {
  return (
    <div
      className="plumb-splash"
      role="status"
      aria-live="polite"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 20,
        background: "var(--surface-page)",
      }}
    >
      {/* Line and bob only. The aperture belongs to the launch sequence; this
          is the plumb hanging while something settles. */}
      <svg width="64" height="64" viewBox="0 0 64 64" aria-hidden="true">
        <path
          className="plumb-splash__line"
          d="M32 4 V60"
          stroke="var(--indigo-2)"
          strokeWidth="3.55"
        />
        <circle className="plumb-splash__bob" cx="32" cy="60" r="3.6" fill="var(--indigo-2)" />
      </svg>

      <div style={{ textAlign: "center" }}>
        <p
          style={{
            margin: 0,
            fontSize: "var(--text-h3)",
            fontWeight: 600,
            color: "var(--text-strong)",
          }}
        >
          {stage}
        </p>
        {detail ? (
          <p
            className="figure"
            style={{ margin: "6px 0 0", fontSize: "var(--text-2xs)", color: "var(--text-muted)" }}
          >
            {detail}
          </p>
        ) : null}
      </div>

      {note ? (
        <p
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: "calc(34px + env(safe-area-inset-bottom))",
            margin: 0,
            padding: "0 24px",
            textAlign: "center",
            fontSize: "var(--text-2xs)",
            lineHeight: 1.55,
            color: "var(--text-faint)",
          }}
        >
          {note}
        </p>
      ) : null}
    </div>
  );
}
