import * as React from "react";
import { cn } from "@/lib/utils";

type Variant = "default" | "outline" | "ghost" | "destructive" | "secondary";
type Size = "default" | "sm" | "lg" | "icon";

const variants: Record<Variant, string> = {
  default: "bg-primary text-primary-foreground hover:bg-primary/90",
  outline: "border border-border bg-card hover:bg-accent",
  ghost: "hover:bg-accent",
  destructive: "bg-destructive text-white hover:bg-destructive/90",
  secondary: "bg-muted text-foreground hover:bg-muted/70",
};

const sizes: Record<Size, string> = {
  default: "h-10 px-4 text-sm md:h-9",
  sm: "h-9 px-3 text-xs md:h-8",
  lg: "h-11 px-6 text-sm md:h-10",
  icon: "h-10 w-10 md:h-9 md:w-9",
};

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "default", size = "default", ...props }, ref) => (
    <button
      ref={ref}
      className={cn(
        "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50",
        variants[variant],
        sizes[size],
        className
      )}
      {...props}
    />
  )
);
Button.displayName = "Button";
