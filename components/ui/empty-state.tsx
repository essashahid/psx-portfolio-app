import { Card, CardContent } from "@/components/ui/card";
import type { LucideIcon } from "lucide-react";

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon?: LucideIcon;
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <Card className="border-dashed">
      <CardContent className="flex flex-col items-center justify-center py-12 text-center">
        {Icon && <Icon className="mb-3 h-8 w-8 text-muted-foreground/60" />}
        <h3 className="text-sm font-semibold">{title}</h3>
        <p className="mt-1 max-w-md text-xs text-muted-foreground">{description}</p>
        {action && <div className="mt-4">{action}</div>}
      </CardContent>
    </Card>
  );
}
