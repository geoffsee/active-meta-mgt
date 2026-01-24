#!/usr/bin/env bun
/**
 * Generate API Key and Secret for HIPAA-compliant ingest authentication
 *
 * Usage:
 *   bun run scripts/generate-api-keys.ts
 *
 * Output can be directly used as environment variables.
 */

import { randomBytes } from "crypto";

const apiKey = `amgt_${randomBytes(24).toString("base64url")}`;
const apiSecret = randomBytes(32).toString("base64url");

console.log(`
# HIPAA-Compliant Ingest API Credentials
# Generated: ${new Date().toISOString()}
#
# Add these to your environment or .env file:

export INGEST_API_KEY="${apiKey}"
export INGEST_API_SECRET="${apiSecret}"

# For Cloudflare Workers, set as secrets:
# wrangler secret put INGEST_API_KEY
# wrangler secret put INGEST_API_SECRET

# Example authenticated request:
# curl -X POST http://localhost:3333/api/ingest \\
#   -H "Content-Type: application/json" \\
#   -H "X-API-Key: ${apiKey}" \\
#   -H "X-Timestamp: $(date +%s000)" \\
#   -H "X-Signature: <hmac-sha256-signature>" \\
#   -d '{"id":"P1","age":65,"diagnosis":"Test"}'
#
# Use scripts/ingest-client.ts for easier authenticated requests.
`);
