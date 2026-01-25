#!/usr/bin/env bun
/**
 * HIPAA-Compliant Ingest Client
 *
 * Example client for making authenticated requests to the protected ingest endpoint.
 * Uses API Key + HMAC-SHA256 signature for medical-grade authentication.
 *
 * Usage:
 *   INGEST_API_KEY=xxx INGEST_API_SECRET=yyy bun run scripts/ingest-client.ts <file.json>
 *   echo '{"id":"P1","age":65}' | INGEST_API_KEY=xxx INGEST_API_SECRET=yyy bun run scripts/ingest-client.ts
 *
 * Environment Variables:
 *   INGEST_API_KEY    - Your API key
 *   INGEST_API_SECRET - Your API secret for HMAC signing
 *   INGEST_URL        - API endpoint (default: http://localhost:3333/api/ingest)
 */

import { createHmac } from "crypto";
import { readFileSync } from "fs";

const API_KEY = process.env.INGEST_API_KEY;
const API_SECRET = process.env.INGEST_API_SECRET;
const BASE_URL = process.env.INGEST_URL || "http://localhost:3333/api/ingest";

if (!API_KEY || !API_SECRET) {
  console.error("Error: INGEST_API_KEY and INGEST_API_SECRET environment variables are required");
  console.error("\nUsage:");
  console.error("  INGEST_API_KEY=xxx INGEST_API_SECRET=yyy bun run scripts/ingest-client.ts <file.json>");
  process.exit(1);
}

async function readInput(): Promise<string> {
  const args = process.argv.slice(2);

  if (args.length > 0) {
    // Read from file
    const filePath = args[0];
    if (!filePath) {
      throw new Error("File path argument missing");
    }
    return readFileSync(filePath, "utf-8");
  }

  // Read from stdin
  const chunks: Buffer[] = [];
  for await (const chunk of Bun.stdin.stream()) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf-8");
}

function signRequest(
  method: string,
  path: string,
  body: string,
  timestamp: number
): string {
  const payload = `${timestamp}${method}${path}${body}`;
  return createHmac("sha256", API_SECRET!)
    .update(payload)
    .digest("hex");
}

async function ingest(data: string): Promise<void> {
  const url = new URL(BASE_URL);
  const timestamp = Date.now();
  const signature = signRequest("POST", url.pathname, data, timestamp);

  console.log(`Ingesting to ${BASE_URL}...`);
  console.log(`Timestamp: ${timestamp}`);
  console.log(`Signature: ${signature.slice(0, 16)}...`);

  const response = await fetch(BASE_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": API_KEY!,
      "X-Timestamp": String(timestamp),
      "X-Signature": signature,
    },
    body: data,
  });

  const result = await response.json();

  if (!response.ok) {
    console.error(`\nError (${response.status}):`, JSON.stringify(result, null, 2));
    process.exit(1);
  }

  console.log(`\nSuccess (${response.status}):`, JSON.stringify(result, null, 2));
}

const input = await readInput();
await ingest(input.trim());
