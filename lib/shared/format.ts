// Formatters moved to @psx/shared so the mobile app compiles the same source.
// cn() and plColor() emit Tailwind class names, so they stay web-side in
// ./style. This re-export keeps existing "@/lib/shared/format" imports working.
export * from "@psx/shared/format";
export { cn, plColor } from "./style";
