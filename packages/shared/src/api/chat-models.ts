import type { ProviderStatus } from "../ai/models";

/**
 * The contract for GET /api/chat/models: which providers this account can
 * actually use. The web page computes the same thing in its server component;
 * the phone has no server render, so it asks.
 */
export interface ChatModelsResponse {
  providers: ProviderStatus;
}
