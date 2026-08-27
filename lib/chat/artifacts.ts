// Moved to @psx/shared so the mobile app renders the same artifact contract.
// This re-export keeps existing "@/lib/chat/artifacts" imports working; new
// code should import from "@psx/shared/chat/artifacts" directly.
export * from "@psx/shared/chat/artifacts";
