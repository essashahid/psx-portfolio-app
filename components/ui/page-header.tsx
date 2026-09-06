export function PageHeader({
  title,
  description,
  eyebrow,
  actions,
}: {
  title: string;
  description?: string;
  /** Small tracked uppercase label above the title (editorial accent). */
  eyebrow?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="mb-4 flex flex-col items-start justify-between gap-3 sm:mb-6 sm:flex-row sm:items-end">
      <div className="rise">
        <span className="mb-3.5 block h-0.75 w-11 bg-indigo" />
        {eyebrow && <p className="eyebrow mb-1.5">{eyebrow}</p>}
        <h1 className="font-display text-(length:--text-h1) font-normal leading-tight tracking-editorial text-text-strong sm:text-(length:--text-title)">{title}</h1>
        {description && (
          <p className="mt-1.5 max-w-xl text-sm text-text-muted">{description}</p>
        )}
      </div>
      {actions && (
        <div className="scroll-touch -mx-1 flex gap-2 overflow-x-auto px-1 sm:mx-0 sm:w-auto sm:flex-wrap sm:overflow-visible sm:px-0">
          {actions}
        </div>
      )}
    </div>
  );
}
