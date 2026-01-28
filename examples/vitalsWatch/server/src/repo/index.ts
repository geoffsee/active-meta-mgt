/**
 * Repository Abstraction Layer
 *
 * This module provides a unified interface for data persistence that works
 * across both Bun (file-based) and Cloudflare Workers (KV-based) runtimes.
 *
 * @example Bun usage:
 * ```typescript
 * import { createRepoContext } from "./repo";
 *
 * const repo = createRepoContext({ runtime: "bun" });
 * const patients = await repo.patients.loadAll();
 * ```
 *
 * @example Cloudflare usage:
 * ```typescript
 * import { createRepoContext } from "./repo";
 *
 * export default {
 *   async fetch(req: Request, env: Env) {
 *     const repo = createRepoContext({ runtime: "cloudflare", kv: env.PATIENTS_KV });
 *     const patients = await repo.patients.loadAll();
 *     // ...
 *   }
 * };
 * ```
 */

// Re-export types
export * from "./types";

// Re-export Bun implementation
export {
  BunIngestRepo,
  BunEvaluationRepo,
  BunPatientRepo,
  BunCooldownRepo,
  BunCredentialsRepo,
  BunAuditLogRepo,
  BunRequestLogRepo,
  createBunRepoContext,
} from "./bun";

// Re-export Cloudflare implementation
export {
  CloudflareIngestRepo,
  CloudflareEvaluationRepo,
  CloudflarePatientRepo,
  CloudflareCooldownRepo,
  CloudflareCredentialsRepo,
  CloudflareAuditLogRepo,
  CloudflareRequestLogRepo,
  createCloudflareRepoContext,
} from "./cloudflare";

import type { IRepoContext, RepoConfig } from "./types";
import { createBunRepoContext } from "./bun";
import { createCloudflareRepoContext } from "./cloudflare";

/**
 * Create a repository context for the specified runtime.
 *
 * This factory function automatically selects the appropriate implementation
 * based on the runtime configuration.
 *
 * @param config - Runtime configuration
 * @returns Repository context with all stores
 */
export function createRepoContext(config: RepoConfig): IRepoContext {
  switch (config.runtime) {
    case "bun":
      return createBunRepoContext(config);
    case "cloudflare":
      return createCloudflareRepoContext(config);
    default:
      throw new Error(`Unknown runtime: ${(config as any).runtime}`);
  }
}

/**
 * Default cooldown duration for patient evaluations (4 hours).
 */
export const DEFAULT_PATIENT_COOLDOWN_MS = 4 * 60 * 60 * 1000;

/**
 * Default evaluation cache TTL (4 hours).
 */
export const DEFAULT_EVAL_CACHE_TTL_MS = 4 * 60 * 60 * 1000;
