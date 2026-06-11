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
    <div className="mb-6 flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-end">
      <div className="rise">
        {eyebrow && <p className="eyebrow mb-1.5">{eyebrow}</p>}
        <h1 className="text-2xl font-semibold tracking-editorial text-foreground">{title}</h1>
        {description && (
          <p className="mt-1 max-w-xl text-sm text-muted-foreground">{description}</p>
        )}
      </div>
      {actions && <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">{actions}</div>}
    </div>
  );
}
