import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Web-only styling helpers. These return Tailwind class names, so they stay
 * here rather than in @psx/shared, which the mobile app also compiles.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function plColor(value: number | null | undefined): string {
  if (value === null || value === undefined || value === 0) return "text-text-muted";
  return value > 0 ? "text-up" : "text-down";
}
