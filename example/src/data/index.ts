/**
 * Data module exports.
 *
 * Provides access to:
 * - Reference data (lab ranges, ICD mappings, drug rules)
 * - Patient data loaders
 * - Transformers (patient → knowledge objects)
 * - Scenario generators
 */

export * from "./reference";
export * from "./loaders";
export * from "./transformers";
export * from "./generators";
