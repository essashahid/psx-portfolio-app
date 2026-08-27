// Moved to @psx/shared so the mobile app compiles the same source.
// This re-export keeps existing "@/lib/news/types.ts" imports working; new code should
// import from "@psx/shared/news/types" directly.
export * from "@psx/shared/news/types";
