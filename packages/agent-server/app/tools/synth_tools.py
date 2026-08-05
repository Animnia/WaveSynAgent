"""Synthesizer tool definitions for the AI Agent.

Each tool maps to a synth parameter mutation. The Agent calls these tools
to control the synthesizer. Results are sent back to the frontend via WebSocket.
"""

from __future__ import annotations

from typing import Any

from .param_specs import validate_mutations

# ─── Tool definitions in OpenAI function-calling format ───

SYNTH_TOOLS: list[dict[str, Any]] = [
    {
        "type": "function",
        "function": {
            "name": "set_params",
            "description": (
                "Batch-set synth parameters by dot path (PREFERRED for multi-parameter "
                "changes — one call instead of many). Paths follow the synth state shape, "
                "e.g. 'oscillators.0.volume', 'filter.cutoff', 'ampEnvelope.attack', "
                "'lfo1.rate', 'effects.reverb.mix', 'master.bpm'. Oscillator index is 0-2. "
                "Invalid entries are rejected with per-parameter error messages; valid ones "
                "are still applied."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "params": {
                        "type": "array",
                        "minItems": 1,
                        "maxItems": 40,
                        "items": {
                            "type": "object",
                            "properties": {
                                "path": {"type": "string", "description": "Dot path, e.g. 'filter.cutoff'"},
                                "value": {"description": "New value (number | boolean | enum string)"},
                            },
                            "required": ["path", "value"],
                            "additionalProperties": False,
                        },
                    }
                },
                "required": ["params"],
                "additionalProperties": False,
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "read_synth_state",
            "description": "Read the current synthesizer state including all oscillators, filter, envelopes, LFOs, effects, and master settings.",
            "parameters": {"type": "object", "properties": {}, "required": []},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "set_oscillator",
            "description": "Set parameters for an oscillator (0=OSC1, 1=OSC2, 2=OSC3).",
            "parameters": {
                "type": "object",
                "properties": {
                    "index": {"type": "integer", "description": "Oscillator index: 0, 1, or 2", "enum": [0, 1, 2]},
                    "enabled": {"type": "boolean"},
                    "type": {"type": "string", "enum": ["sine", "triangle", "sawtooth", "square"]},
                    "volume": {"type": "number", "minimum": 0, "maximum": 1},
                    "semitone": {"type": "integer", "minimum": -24, "maximum": 24},
                    "fine": {"type": "integer", "minimum": -100, "maximum": 100},
                    "pan": {"type": "number", "minimum": -1, "maximum": 1},
                    "unison": {"type": "integer", "minimum": 1, "maximum": 8},
                    "unisonSpread": {"type": "number", "minimum": 0, "maximum": 100},
                },
                "required": ["index"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "set_filter",
            "description": "Set filter parameters (lowpass, highpass, bandpass, notch).",
            "parameters": {
                "type": "object",
                "properties": {
                    "enabled": {"type": "boolean"},
                    "type": {"type": "string", "enum": ["lowpass", "highpass", "bandpass", "notch"]},
                    "cutoff": {"type": "number", "minimum": 20, "maximum": 20000, "description": "Cutoff frequency in Hz"},
                    "resonance": {"type": "number", "minimum": 0, "maximum": 1},
                    "envelopeAmount": {"type": "number", "minimum": -1, "maximum": 1},
                    "keyTracking": {"type": "number", "minimum": 0, "maximum": 1},
                },
                "required": [],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "set_envelope",
            "description": "Set ADSR envelope parameters for amplitude or filter envelope.",
            "parameters": {
                "type": "object",
                "properties": {
                    "type": {"type": "string", "enum": ["amp", "filter"], "description": "Which envelope to modify"},
                    "attack": {"type": "number", "minimum": 0.001, "maximum": 5, "description": "Attack time in seconds"},
                    "decay": {"type": "number", "minimum": 0.001, "maximum": 5, "description": "Decay time in seconds"},
                    "sustain": {"type": "number", "minimum": 0, "maximum": 1, "description": "Sustain level (0-1)"},
                    "release": {"type": "number", "minimum": 0.001, "maximum": 10, "description": "Release time in seconds"},
                },
                "required": ["type"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "set_lfo",
            "description": "Set LFO parameters (LFO 1 or LFO 2).",
            "parameters": {
                "type": "object",
                "properties": {
                    "index": {"type": "integer", "enum": [1, 2], "description": "LFO number (1 or 2)"},
                    "enabled": {"type": "boolean"},
                    "waveform": {"type": "string", "enum": ["sine", "triangle", "sawtooth", "square"]},
                    "rate": {"type": "number", "minimum": 0.01, "maximum": 50, "description": "Rate in Hz"},
                    "depth": {"type": "number", "minimum": 0, "maximum": 1},
                    "target": {"type": "string", "enum": ["filterCutoff", "volume", "pitch", "pan"]},
                },
                "required": ["index"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "set_effects",
            "description": "Set effect parameters. Specify one or more effect blocks to update.",
            "parameters": {
                "type": "object",
                "properties": {
                    "reverb": {
                        "type": "object",
                        "properties": {
                            "enabled": {"type": "boolean"},
                            "size": {"type": "number", "minimum": 0, "maximum": 1},
                            "damping": {"type": "number", "minimum": 0, "maximum": 1},
                            "mix": {"type": "number", "minimum": 0, "maximum": 1},
                        },
                    },
                    "delay": {
                        "type": "object",
                        "properties": {
                            "enabled": {"type": "boolean"},
                            "time": {"type": "number", "minimum": 0.01, "maximum": 2},
                            "feedback": {"type": "number", "minimum": 0, "maximum": 0.95},
                            "mix": {"type": "number", "minimum": 0, "maximum": 1},
                        },
                    },
                    "chorus": {
                        "type": "object",
                        "properties": {
                            "enabled": {"type": "boolean"},
                            "rate": {"type": "number", "minimum": 0.1, "maximum": 10},
                            "depth": {"type": "number", "minimum": 0, "maximum": 1},
                            "mix": {"type": "number", "minimum": 0, "maximum": 1},
                        },
                    },
                    "distortion": {
                        "type": "object",
                        "properties": {
                            "enabled": {"type": "boolean"},
                            "drive": {"type": "number", "minimum": 0, "maximum": 1},
                            "mix": {"type": "number", "minimum": 0, "maximum": 1},
                        },
                    },
                    "compressor": {
                        "type": "object",
                        "properties": {
                            "enabled": {"type": "boolean"},
                            "threshold": {"type": "number", "minimum": -60, "maximum": 0, "description": "dB"},
                            "ratio": {"type": "number", "minimum": 1, "maximum": 20},
                            "attack": {"type": "number", "minimum": 0.001, "maximum": 1, "description": "seconds"},
                            "release": {"type": "number", "minimum": 0.01, "maximum": 1, "description": "seconds"},
                        },
                    },
                    "eq3": {
                        "type": "object",
                        "properties": {
                            "enabled": {"type": "boolean"},
                            "low": {"type": "number", "minimum": -24, "maximum": 24, "description": "dB"},
                            "mid": {"type": "number", "minimum": -24, "maximum": 24, "description": "dB"},
                            "high": {"type": "number", "minimum": -24, "maximum": 24, "description": "dB"},
                            "lowFrequency": {"type": "number", "minimum": 50, "maximum": 1000},
                            "highFrequency": {"type": "number", "minimum": 1000, "maximum": 10000},
                        },
                    },
                    "phaser": {
                        "type": "object",
                        "properties": {
                            "enabled": {"type": "boolean"},
                            "rate": {"type": "number", "minimum": 0.1, "maximum": 10},
                            "depth": {"type": "number", "minimum": 0, "maximum": 1},
                            "baseFrequency": {"type": "number", "minimum": 20, "maximum": 2000},
                            "octaves": {"type": "integer", "minimum": 1, "maximum": 7},
                            "mix": {"type": "number", "minimum": 0, "maximum": 1},
                        },
                    },
                    "bitCrusher": {
                        "type": "object",
                        "properties": {
                            "enabled": {"type": "boolean"},
                            "bits": {"type": "integer", "minimum": 1, "maximum": 16},
                            "mix": {"type": "number", "minimum": 0, "maximum": 1},
                        },
                    },
                    "stereoWidener": {
                        "type": "object",
                        "properties": {
                            "enabled": {"type": "boolean"},
                            "width": {"type": "number", "minimum": 0, "maximum": 1},
                        },
                    },
                },
                "required": [],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "set_master",
            "description": "Set master volume and BPM.",
            "parameters": {
                "type": "object",
                "properties": {
                    "volume": {"type": "number", "minimum": 0, "maximum": 1},
                    "bpm": {"type": "integer", "minimum": 40, "maximum": 300},
                },
                "required": [],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "play_notes",
            "description": "Play one or more MIDI notes. Use mode='chord' for simultaneous notes, mode='sequence' to play them one after another (arpeggio/melody).",
            "parameters": {
                "type": "object",
                "properties": {
                    "notes": {
                        "type": "array",
                        "items": {"type": "integer", "minimum": 21, "maximum": 108},
                        "description": "MIDI note numbers (e.g. 60=C4, 64=E4, 67=G4)",
                    },
                    "velocity": {"type": "integer", "minimum": 1, "maximum": 127, "default": 100},
                    "duration": {"type": "number", "minimum": 0.05, "maximum": 5, "description": "Per-note duration in seconds."},
                    "mode": {"type": "string", "enum": ["chord", "sequence"], "description": "chord = play all notes simultaneously, sequence = play one after another.", "default": "chord"},
                    "interval": {"type": "number", "minimum": 0.05, "maximum": 2, "description": "Time between successive note onsets in sequence mode (seconds). Defaults to duration."},
                },
                "required": ["notes"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "set_mod_route",
            "description": "Add, update, or remove a modulation matrix route. Routes connect a modulator (LFO) to a destination parameter with a bipolar depth (-1..1).",
            "parameters": {
                "type": "object",
                "properties": {
                    "operation": {"type": "string", "enum": ["add", "update", "remove"]},
                    "id": {"type": "string", "description": "Route id. Required for update/remove. For add, omit (the frontend will generate one)."},
                    "source": {"type": "string", "enum": ["lfo1", "lfo2"], "description": "Modulation source."},
                    "destination": {
                        "type": "string",
                        "enum": [
                            "filter.cutoff",
                            "filter.resonance",
                            "master.volume",
                            "effects.reverb.mix",
                            "effects.delay.feedback"
                        ],
                    },
                    "depth": {"type": "number", "minimum": -1, "maximum": 1, "description": "Bipolar modulation depth."},
                    "enabled": {"type": "boolean"},
                },
                "required": ["operation"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "reorder_effect_chain",
            "description": "Reorder the serial effect chain. Provide all 9 effect ids in the desired processing order (signal flows from index 0 to last).",
            "parameters": {
                "type": "object",
                "properties": {
                    "order": {
                        "type": "array",
                        "items": {
                            "type": "string",
                            "enum": ["distortion", "bitCrusher", "compressor", "eq3", "chorus", "phaser", "delay", "reverb", "stereoWidener"],
                        },
                        "minItems": 9,
                        "maxItems": 9,
                    },
                },
                "required": ["order"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "save_preset",
            "description": "Save the current synthesizer state as a named preset on the user's device. Use this when the user explicitly asks to save the current sound or after designing a notable patch.",
            "parameters": {
                "type": "object",
                "properties": {
                    "name": {"type": "string", "description": "Preset name (1-40 chars)"},
                    "tags": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Optional descriptive tags like 'pad', 'bass', 'lead'",
                    },
                },
                "required": ["name"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "explain_concept",
            "description": "Explain a music production or synthesis concept to the user. Use this when teaching.",
            "parameters": {
                "type": "object",
                "properties": {
                    "topic": {"type": "string", "description": "The concept to explain"},
                    "level": {"type": "string", "enum": ["beginner", "intermediate", "advanced"]},
                },
                "required": ["topic"],
            },
        },
    },
]


# ─── Tool execution ───

def validate_range(value: Any, min_val: float, max_val: float, name: str) -> float | int:
    """Validate a numeric parameter is within range."""
    v = float(value)
    if v < min_val or v > max_val:
        raise ValueError(f"{name} must be between {min_val} and {max_val}, got {v}")
    return v


def execute_tool(tool_name: str, arguments: dict[str, Any], synth_state: dict[str, Any]) -> dict[str, Any]:
    """Execute a tool call and return the result + state mutations.

    Returns:
        {
            "result": str (human-readable),
            "mutations": list of dicts describing state changes to apply,
            "play": optional note play commands,
        }
    """
    match tool_name:
        case "read_synth_state":
            return {"result": _format_state(synth_state), "mutations": []}

        case "set_params":
            return _set_params(arguments)

        case "set_oscillator":
            return _finalize(_set_oscillator(arguments, synth_state))

        case "set_filter":
            return _finalize(_set_filter(arguments, synth_state))

        case "set_envelope":
            return _finalize(_set_envelope(arguments, synth_state))

        case "set_lfo":
            return _finalize(_set_lfo(arguments, synth_state))

        case "set_effects":
            return _finalize(_set_effects(arguments, synth_state))

        case "set_master":
            return _finalize(_set_master(arguments, synth_state))

        case "set_mod_route":
            return _set_mod_route(arguments, synth_state)

        case "reorder_effect_chain":
            return _reorder_effect_chain(arguments, synth_state)

        case "play_notes":
            notes = arguments.get("notes", [60])
            velocity = arguments.get("velocity", 100)
            duration = arguments.get("duration", 0.5)
            mode = arguments.get("mode", "chord")
            interval = arguments.get("interval", duration)
            return {
                "result": f"Playing {mode}: {notes}",
                "mutations": [],
                "play": {
                    "notes": notes,
                    "velocity": velocity,
                    "duration": duration,
                    "mode": mode,
                    "interval": interval,
                },
            }

        case "save_preset":
            name = str(arguments.get("name", "")).strip()[:40] or "Untitled"
            tags = arguments.get("tags", []) or []
            if not isinstance(tags, list):
                tags = []
            tags = [str(t)[:20] for t in tags][:8]
            return {
                "result": f"Preset '{name}' saved to user device.",
                "mutations": [],
                "save_preset": {"name": name, "tags": tags},
            }

        case "explain_concept":
            # The LLM's text response IS the explanation; we just pass through
            return {"result": f"[Explaining: {arguments.get('topic', '?')}]", "mutations": []}

        case _:
            return {"result": f"Unknown tool: {tool_name}", "mutations": []}


def _set_params(args: dict) -> dict:
    """Batch parameter set — validate every entry against the spec registry."""
    entries = args.get("params") or []
    if not isinstance(entries, list) or not entries:
        return {"result": "set_params requires a non-empty 'params' array", "mutations": []}

    raw: list[dict[str, Any]] = []
    shape_errors: list[str] = []
    for i, e in enumerate(entries):
        if not isinstance(e, dict) or "path" not in e or "value" not in e:
            shape_errors.append(f"params[{i}] must be an object with 'path' and 'value'")
            continue
        raw.append({"path": str(e["path"]), "value": e["value"]})

    valid, errors = validate_mutations(raw)
    errors = shape_errors + errors

    summary = f"Applied {len(valid)} parameter(s)."
    if errors:
        summary += " Rejected: " + "; ".join(errors)
    return {"result": summary, "mutations": valid}


def _finalize(result: dict) -> dict:
    """Post-validate granular-tool mutations against the spec registry.

    The tool schemas already constrain arguments, but the executors pass keys
    through verbatim — this is the safety net that guarantees only known,
    in-range parameter paths ever reach the frontend.
    """
    valid, errors = validate_mutations(result.get("mutations", []))
    result["mutations"] = valid
    if errors:
        result["result"] += " | Rejected: " + "; ".join(errors)
    return result


def _set_oscillator(args: dict, state: dict) -> dict:
    idx = args.pop("index")
    mutations = []
    for key, val in args.items():
        mutations.append({"path": f"oscillators.{idx}.{key}", "value": val})
    return {
        "result": f"OSC {idx + 1} updated: {', '.join(f'{k}={v}' for k, v in args.items())}",
        "mutations": mutations,
    }


def _set_filter(args: dict, state: dict) -> dict:
    mutations = [{"path": f"filter.{k}", "value": v} for k, v in args.items()]
    return {
        "result": f"Filter updated: {', '.join(f'{k}={v}' for k, v in args.items())}",
        "mutations": mutations,
    }


def _set_envelope(args: dict, state: dict) -> dict:
    env_type = args.pop("type")
    key = "ampEnvelope" if env_type == "amp" else "filterEnvelope"
    mutations = [{"path": f"{key}.{k}", "value": v} for k, v in args.items()]
    return {
        "result": f"{env_type.upper()} envelope updated: {', '.join(f'{k}={v}' for k, v in args.items())}",
        "mutations": mutations,
    }


def _set_lfo(args: dict, state: dict) -> dict:
    idx = args.pop("index")
    key = f"lfo{idx}"
    mutations = [{"path": f"{key}.{k}", "value": v} for k, v in args.items()]
    return {
        "result": f"LFO {idx} updated: {', '.join(f'{k}={v}' for k, v in args.items())}",
        "mutations": mutations,
    }


def _set_effects(args: dict, state: dict) -> dict:
    mutations = []
    descriptions = []
    for effect_name, params in args.items():
        if isinstance(params, dict):
            for k, v in params.items():
                mutations.append({"path": f"effects.{effect_name}.{k}", "value": v})
            descriptions.append(f"{effect_name}: {', '.join(f'{k}={v}' for k, v in params.items())}")
    return {
        "result": f"Effects updated: {'; '.join(descriptions)}",
        "mutations": mutations,
    }


def _set_master(args: dict, state: dict) -> dict:
    mutations = [{"path": f"master.{k}", "value": v} for k, v in args.items()]
    return {
        "result": f"Master updated: {', '.join(f'{k}={v}' for k, v in args.items())}",
        "mutations": mutations,
    }


def _set_mod_route(args: dict, state: dict) -> dict:
    op = args.get("operation")
    if op == "add":
        route = {
            "source": args.get("source", "lfo1"),
            "destination": args.get("destination", "filter.cutoff"),
            "depth": args.get("depth", 0.5),
            "enabled": args.get("enabled", True),
        }
        return {
            "result": f"Added mod route: {route['source']} -> {route['destination']} (depth={route['depth']})",
            "mutations": [{"path": "modulation.add", "value": route}],
        }
    if op == "remove":
        route_id = args.get("id")
        if not route_id:
            return {"result": "remove operation requires 'id'", "mutations": []}
        return {
            "result": f"Removed mod route {route_id}",
            "mutations": [{"path": "modulation.remove", "value": route_id}],
        }
    if op == "update":
        route_id = args.get("id")
        if not route_id:
            return {"result": "update operation requires 'id'", "mutations": []}
        patch = {k: v for k, v in args.items() if k in ("source", "destination", "depth", "enabled")}
        return {
            "result": f"Updated mod route {route_id}: {patch}",
            "mutations": [{"path": f"modulation.update.{route_id}", "value": patch}],
        }
    return {"result": f"Unknown mod route operation: {op}", "mutations": []}


def _reorder_effect_chain(args: dict, state: dict) -> dict:
    order = args.get("order", []) or []
    valid = {"distortion", "bitCrusher", "compressor", "eq3", "chorus", "phaser", "delay", "reverb", "stereoWidener"}
    if not isinstance(order, list) or set(order) != valid or len(order) != 9:
        return {"result": f"effect_chain order must be a permutation of {sorted(valid)}", "mutations": []}
    return {
        "result": f"Effect chain reordered: {' -> '.join(order)}",
        "mutations": [{"path": "effectChain", "value": order}],
    }


def _format_state(state: dict) -> str:
    """Format synth state as a readable summary for the LLM."""
    lines = []
    oscs = state.get("oscillators", [])
    for i, osc in enumerate(oscs):
        status = "ON" if osc.get("enabled") else "OFF"
        lines.append(
            f"OSC{i+1}: {status} | {osc.get('type','?')} | vol={osc.get('volume',0):.2f} "
            f"| semi={osc.get('semitone',0)} | fine={osc.get('fine',0)} | pan={osc.get('pan',0):.2f} "
            f"| unison={osc.get('unison',1)} spread={osc.get('unisonSpread',0)}"
        )

    f = state.get("filter", {})
    lines.append(
        f"Filter: {'ON' if f.get('enabled') else 'OFF'} | {f.get('type','?')} "
        f"| cutoff={f.get('cutoff',0):.0f}Hz | reso={f.get('resonance',0):.2f}"
    )

    for env_name in ["ampEnvelope", "filterEnvelope"]:
        e = state.get(env_name, {})
        label = "AMP" if "amp" in env_name else "FLT"
        lines.append(
            f"{label} Env: A={e.get('attack',0):.3f} D={e.get('decay',0):.3f} "
            f"S={e.get('sustain',0):.2f} R={e.get('release',0):.3f}"
        )

    for i in [1, 2]:
        lfo = state.get(f"lfo{i}", {})
        lines.append(
            f"LFO{i}: {'ON' if lfo.get('enabled') else 'OFF'} | {lfo.get('waveform','?')} "
            f"| rate={lfo.get('rate',0):.2f}Hz | depth={lfo.get('depth',0):.2f} | target={lfo.get('target','?')}"
        )

    fx = state.get("effects", {})
    for fx_name in ["reverb", "delay", "chorus", "distortion", "compressor", "eq3", "phaser", "bitCrusher", "stereoWidener"]:
        fxd = fx.get(fx_name, {})
        status = "ON" if fxd.get("enabled") else "OFF"
        params = ", ".join(f"{k}={v}" for k, v in fxd.items() if k != "enabled")
        lines.append(f"{fx_name}: {status} | {params}")

    chain = state.get("effectChain")
    if isinstance(chain, list) and chain:
        lines.append(f"EffectChain: {' -> '.join(chain)}")

    routes = state.get("modulation", {}).get("routes", []) if isinstance(state.get("modulation"), dict) else state.get("modulation", [])
    if isinstance(routes, list) and routes:
        lines.append("Modulation:")
        for r in routes:
            en = "ON" if r.get("enabled", True) else "OFF"
            lines.append(f"  [{r.get('id','?')}] {en} {r.get('source','?')} -> {r.get('destination','?')} depth={r.get('depth',0)}")
    else:
        lines.append("Modulation: (空)")

    m = state.get("master", {})
    lines.append(f"Master: vol={m.get('volume',0):.2f} | bpm={m.get('bpm',120)}")

    return "\n".join(lines)
