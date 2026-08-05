#!/usr/bin/env node
/**
 * Export the canonical parameter registry (src/engine/paramSpecs.json)
 * to the agent-server so the Python side can validate `set_params` calls
 * against the exact same spec.
 *
 *   node scripts/exportParamSpecs.mjs          # write the mirror
 *   node scripts/exportParamSpecs.mjs --check  # fail if the mirror is stale
 *
 * The generated file is committed; run this after editing paramSpecs.json.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const SOURCE = resolve(here, '../src/engine/paramSpecs.json');
const TARGET = resolve(here, '../../agent-server/app/tools/param_specs.json');

const raw = readFileSync(SOURCE, 'utf-8');
const specs = JSON.parse(raw);

// Sanity-check the spec shape before exporting.
const TYPES = new Set(['number', 'integer', 'boolean', 'enum']);
const seen = new Set();
for (const p of specs.params) {
  if (!p.path || !TYPES.has(p.type) || !p.label) {
    throw new Error(`invalid spec entry: ${JSON.stringify(p)}`);
  }
  if ((p.type === 'number' || p.type === 'integer') && (p.min === undefined || p.max === undefined)) {
    throw new Error(`numeric spec needs min/max: ${p.path}`);
  }
  if (p.type === 'enum' && !Array.isArray(p.values)) {
    throw new Error(`enum spec needs values: ${p.path}`);
  }
  if (seen.has(p.path)) throw new Error(`duplicate spec path: ${p.path}`);
  seen.add(p.path);
}

const out = JSON.stringify(specs, null, 2) + '\n';

if (process.argv.includes('--check')) {
  let current = null;
  try {
    current = readFileSync(TARGET, 'utf-8');
  } catch {
    /* missing */
  }
  if (current !== out) {
    console.error('param_specs.json is stale — run `pnpm --filter frontend gen:params`');
    process.exit(1);
  }
  console.log('param_specs.json is up to date.');
  process.exit(0);
}

writeFileSync(TARGET, out);
console.log(`Exported ${specs.params.length} param specs → ${TARGET}`);
