/**
 * Schema-driven parameter registry — the frontend's authoritative validator
 * and dispatcher for dot-path mutations (e.g. "oscillators.0.volume").
 *
 * The spec list lives in paramSpecs.json (single source of truth, mirrored
 * to the agent-server via `pnpm gen:params`). Adding a new controllable
 * parameter = one JSON entry + the engine/store support for it; the agent
 * protocol, validation, and UI dispatch all flow from here.
 */
import rawSpecs from './paramSpecs.json';

export type ParamValueType = 'number' | 'integer' | 'boolean' | 'enum';

export interface ParamSpec {
  path: string;
  type: ParamValueType;
  label: string;
  min?: number;
  max?: number;
  values?: string[];
}

export const PARAM_SPECS: readonly ParamSpec[] = rawSpecs.params as ParamSpec[];

/** Segments that must never be written through (prototype-pollution guard). */
const FORBIDDEN_SEGMENTS = new Set(['__proto__', 'constructor', 'prototype']);

function segments(path: string): string[] {
  return path.split('.');
}

/** Find the spec for a concrete path, honoring '*' single-segment wildcards. */
export function matchSpec(path: string): ParamSpec | undefined {
  const parts = segments(path);
  return PARAM_SPECS.find((spec) => {
    const specParts = spec.path.split('.');
    if (specParts.length !== parts.length) return false;
    return specParts.every((sp, i) => sp === '*' || sp === parts[i]);
  });
}

export interface ValidationOk {
  ok: true;
  /** Coerced value (integers are rounded, numbers coerced from numeric strings). */
  value: number | boolean | string;
}
export interface ValidationErr {
  ok: false;
  error: string;
}
export type ValidationResult = ValidationOk | ValidationErr;

/**
 * Validate (and lightly coerce) a value against the spec for `path`.
 * The frontend is authoritative: anything failing here must NOT reach state.
 */
export function validateMutation(path: string, value: unknown): ValidationResult {
  const parts = segments(path);
  if (parts.some((p) => FORBIDDEN_SEGMENTS.has(p))) {
    return { ok: false, error: `forbidden path segment in '${path}'` };
  }
  const spec = matchSpec(path);
  if (!spec) {
    return { ok: false, error: `unknown parameter path '${path}'` };
  }

  switch (spec.type) {
    case 'boolean': {
      if (typeof value !== 'boolean') {
        return { ok: false, error: `${spec.label} expects boolean, got ${JSON.stringify(value)}` };
      }
      return { ok: true, value };
    }
    case 'enum': {
      if (typeof value !== 'string' || !spec.values?.includes(value)) {
        return {
          ok: false,
          error: `${spec.label} expects one of [${spec.values?.join(', ')}], got ${JSON.stringify(value)}`,
        };
      }
      return { ok: true, value };
    }
    case 'integer':
    case 'number': {
      const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
      if (typeof n !== 'number' || Number.isNaN(n) || !Number.isFinite(n)) {
        return { ok: false, error: `${spec.label} expects a number, got ${JSON.stringify(value)}` };
      }
      let v = n;
      if (spec.type === 'integer') v = Math.round(v);
      if (spec.min !== undefined && v < spec.min) {
        return { ok: false, error: `${spec.label} must be >= ${spec.min}, got ${v}` };
      }
      if (spec.max !== undefined && v > spec.max) {
        return { ok: false, error: `${spec.label} must be <= ${spec.max}, got ${v}` };
      }
      return { ok: true, value: v };
    }
  }
}

/** Generic deep-set along a validated dot path (numeric segments index arrays). */
export function setByPath(target: unknown, path: string, value: unknown): void {
  const parts = segments(path);
  let obj = target as Record<string, unknown>;
  for (let i = 0; i < parts.length - 1; i++) {
    obj = obj[parts[i]] as Record<string, unknown>;
  }
  obj[parts[parts.length - 1]] = value;
}
