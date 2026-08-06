"""Synthesizer tool definitions for the AI Agent.

Each tool maps to a synth parameter mutation. The Agent calls these tools
to control the synthesizer. Results are sent back to the frontend via WebSocket.
"""

from __future__ import annotations

from typing import Any, Protocol

from .param_specs import validate_mutations

# ─── Tool definitions in OpenAI function-calling format ───

_NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]

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
                    "track_index": {
                        "type": "integer",
                        "minimum": 0,
                        "maximum": 7,
                        "description": "Target track (0-based). Omit to target the ACTIVE track.",
                    },
                    "params": {
                        "type": "array",
                        "minItems": 1,
                        "maxItems": 40,
                        "items": {
                            "type": "object",
                            "properties": {
                                "path": {
                                    "type": "string",
                                    "description": "Dot path, e.g. 'filter.cutoff'",
                                },
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
                    "type": {"type": "string", "enum": ["sine", "triangle", "sawtooth", "square", "custom"]},
                    "wavetable": {
                        "type": "string",
                        "enum": ["morph", "formant", "digital", "soft"],
                        "description": "Wavetable for type='custom': morph=basic shapes blend, formant=vocal, digital=harsh/metallic, soft=mellow",
                    },
                    "wavetablePosition": {
                        "type": "number",
                        "minimum": 0,
                        "maximum": 1,
                        "description": "Morph position through the wavetable frames (0=first frame, 1=last)",
                    },
                    "fmAmount": {
                        "type": "number",
                        "minimum": 0,
                        "maximum": 1,
                        "description": "FM depth (only effective on index 0): audio-rate FM from OSC2 into OSC1. 0.1-0.3 subtle growl, 0.4+ metallic/bell-like",
                    },
                    "volume": {"type": "number", "minimum": 0, "maximum": 1},
                    "semitone": {"type": "integer", "minimum": -24, "maximum": 24},
                    "fine": {"type": "integer", "minimum": -100, "maximum": 100},
                    "detune": {"type": "integer", "minimum": -1200, "maximum": 1200},
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
                    "source": {"type": "string", "enum": ["lfo1", "lfo2", "modwheel"], "description": "Modulation source. modwheel = performance wheel (CC1), a DC offset scaled by wheel position."},
                    "destination": {
                        "type": "string",
                        "enum": [
                            "filter.cutoff",
                            "filter.resonance",
                            "master.volume",
                            "effects.reverb.mix",
                            "effects.delay.feedback",
                            "effects.phaser.rate",
                            "effects.chorus.rate",
                            "voices.pitch",
                            "voices.pan"
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
            "name": "snapshot_patch",
            "description": "Save the current synth state as a restore point (overwrites the previous one). Use BEFORE making bold/experimental changes, so you can roll back if the user dislikes the result.",
            "parameters": {"type": "object", "properties": {}, "required": []},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "restore_snapshot",
            "description": "Restore the synth state saved by snapshot_patch. Use when the user wants to go back to the sound before your experimental changes.",
            "parameters": {"type": "object", "properties": {}, "required": []},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "undo_last_change",
            "description": "Undo the most recent synth parameter change (yours or the user's). Use when the user says 'undo'/'revert', or to step back one edit.",
            "parameters": {"type": "object", "properties": {}, "required": []},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "analyze_audio",
            "description": (
                "Play notes through the current patch and analyze the ACTUAL audio output: "
                "loudness (RMS/peak dBFS), clipping, brightness (spectral centroid Hz), and "
                "band balance (sub/low-mid/presence/air in dB). Use this to VERIFY your work — "
                "e.g. after designing a 'warm pad', check the centroid is low and sub/presence "
                "balanced. Closes the loop: adjust → analyze → re-adjust."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "notes": {
                        "type": "array",
                        "items": {"type": "integer", "minimum": 21, "maximum": 108},
                        "description": "MIDI notes to ring (played as a chord). Default: C major triad [60, 64, 67].",
                    },
                    "duration": {
                        "type": "number",
                        "minimum": 0.5,
                        "maximum": 3,
                        "description": "Capture window in seconds (default 1.5). Use longer for slow-attack pads.",
                    },
                },
                "required": [],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "sequence_pattern",
            "description": (
                "Write a looping step-sequencer pattern (16 or 32 sixteenth-note steps) that "
                "plays through the CURRENT patch. Replaces the existing pattern. Use it to "
                "demo a sound in context (basslines, arps, riffs) or to write loops on request. "
                "Start playback with sequencer_control afterwards."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "track_index": {
                        "type": "integer",
                        "minimum": 0,
                        "maximum": 7,
                        "description": "Target track (0-based). Omit to target the ACTIVE track.",
                    },
                    "steps": {"type": "integer", "enum": [16, 32]},
                    "notes": {
                        "type": "array",
                        "maxItems": 64,
                        "items": {
                            "type": "object",
                            "properties": {
                                "note": {"type": "integer", "minimum": 21, "maximum": 108},
                                "start": {"type": "integer", "minimum": 0, "description": "0-based step index"},
                                "duration": {"type": "integer", "minimum": 1, "maximum": 32, "description": "length in steps (default 1)"},
                                "velocity": {"type": "integer", "minimum": 1, "maximum": 127, "default": 100},
                            },
                            "required": ["note", "start"],
                        },
                    },
                    "name": {"type": "string", "description": "Optional pattern name"},
                },
                "required": ["steps", "notes"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "sequencer_control",
            "description": "Start or stop a track's step sequencer. Start it after writing a pattern so the user hears the loop; stop when asked or before demonstrating one-shot notes.",
            "parameters": {
                "type": "object",
                "properties": {
                    "action": {"type": "string", "enum": ["start", "stop"]},
                    "track_index": {
                        "type": "integer",
                        "minimum": 0,
                        "maximum": 7,
                        "description": "Target track (0-based). Omit to target the ACTIVE track.",
                    },
                },
                "required": ["action"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "export_audio",
            "description": (
                "Render the current patch to a WAV file that downloads on the user's device. "
                "If a sequencer pattern exists it loops for 'bars' bars; otherwise a demo chord "
                "('notes') rings for 'duration' seconds. Use when the user asks to export/bounce/save audio."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "bars": {"type": "integer", "minimum": 1, "maximum": 8, "description": "Pattern loops (when a pattern exists). Default 2."},
                    "duration": {"type": "number", "minimum": 0.5, "maximum": 30, "description": "Seconds for the chord demo (no pattern). Default 3."},
                    "notes": {
                        "type": "array",
                        "items": {"type": "integer", "minimum": 21, "maximum": 108},
                        "description": "Chord for the demo render (default C major triad).",
                    },
                },
                "required": [],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "create_track",
            "description": (
                "Create a new track with its own independent synth engine + pattern, and "
                "switch to it. Use for layering sounds (e.g. a bass on track 2 under a pad "
                "on track 1). Max 8 tracks. The track list is in your context as 'tracks'."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "name": {"type": "string", "description": "Track name (e.g. 'Bass', 'Pad')"},
                },
                "required": [],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "select_track",
            "description": (
                "Switch the active track. The active track is what the user is looking at; "
                "set_params/sequence_pattern/sequencer_control default to it. Its synth state "
                "becomes your context on the next turn."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "track_index": {"type": "integer", "minimum": 0, "maximum": 7},
                },
                "required": ["track_index"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "set_track_mixer",
            "description": (
                "Mix a track in the multi-track mixer: level, pan, mute, solo. Use for "
                "balancing layers (e.g. 'make the pad quieter', 'solo the bass')."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "track_index": {
                        "type": "integer",
                        "minimum": 0,
                        "maximum": 7,
                        "description": "Target track (0-based). Omit for the ACTIVE track.",
                    },
                    "volume": {"type": "number", "minimum": 0, "maximum": 1},
                    "pan": {"type": "number", "minimum": -1, "maximum": 1},
                    "mute": {"type": "boolean"},
                    "solo": {"type": "boolean"},
                },
                "required": [],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "set_goals",
            "description": (
                "Declare an ordered goal list for a COMPLEX multi-step task, then work "
                "through it autonomously — no user confirmation needed. The goals render "
                "as a live checklist the user can watch. Use for tasks with 3+ distinct "
                "steps; skip it for simple one-shot requests."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "goals": {
                        "type": "array",
                        "minItems": 2,
                        "maxItems": 10,
                        "items": {"type": "string"},
                        "description": "Ordered goals, each one short line (e.g. 'Design the bass patch on track 2')",
                    },
                },
                "required": ["goals"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "update_goal",
            "description": (
                "Mark progress on the goal list created with set_goals: set a goal "
                "in_progress when you start it and done when it is finished, then move on "
                "to the next one."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "index": {"type": "integer", "minimum": 0, "description": "0-based goal index"},
                    "status": {"type": "string", "enum": ["in_progress", "done"]},
                },
                "required": ["index", "status"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "propose_plan",
            "description": (
                "Propose a step-by-step plan to the user BEFORE executing it. The plan is "
                "rendered as a card the user can confirm or cancel. Use for multi-step work "
                "(designing a layered patch, building an arrangement across tracks) and "
                "ALWAYS when plan mode is on. After the user confirms, execute the steps."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "title": {"type": "string", "description": "Short plan title"},
                    "steps": {
                        "type": "array",
                        "minItems": 1,
                        "maxItems": 12,
                        "items": {"type": "string"},
                        "description": "Ordered steps, each one line (e.g. '1. 新建 Bass 轨并调出 sub 音色')",
                    },
                },
                "required": ["title", "steps"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "update_preferences",
            "description": (
                "Remember durable user preferences (taste memory). Call when the user states "
                "a stable preference ('我喜欢暗一点的音色', '以后 BPM 都在 90 左右', "
                "'别用太多混响'). Keys are short snake_case labels, values short strings. "
                "Preferences persist across sessions and appear in your context as 用户偏好."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "preferences": {
                        "type": "object",
                        "description": "key→value patch, e.g. {\"brightness\": \"偏暗\", \"reverb_usage\": \"少量\"}. Set a value to empty string to forget it.",
                        "additionalProperties": {"type": "string"},
                    },
                },
                "required": ["preferences"],
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

class AnalysisChannel(Protocol):
    """Channel back to the client for audio analysis (implemented by the WS layer)."""

    async def request_analysis(self, payload: dict[str, Any]) -> dict[str, Any] | None: ...


async def execute_tool_async(
    tool_name: str,
    arguments: dict[str, Any],
    synth_state: dict[str, Any],
    channel: AnalysisChannel | None = None,
) -> dict[str, Any]:
    """Async variant of execute_tool for tools that need a client round-trip."""
    if tool_name == "analyze_audio":
        return await _analyze_audio(arguments, channel)
    return execute_tool(tool_name, arguments, synth_state)


async def _analyze_audio(args: dict, channel: AnalysisChannel | None) -> dict:
    if channel is None:
        return {"result": "audio analysis unavailable (no client connection)", "mutations": []}

    notes = args.get("notes") or [60, 64, 67]
    if not isinstance(notes, list):
        notes = [60, 64, 67]
    notes = [max(21, min(108, int(n))) for n in notes[:8] if isinstance(n, (int, float))]
    if not notes:
        notes = [60, 64, 67]
    try:
        duration = float(args.get("duration") or 1.5)
    except (TypeError, ValueError):
        duration = 1.5
    duration = max(0.5, min(3.0, duration))

    features = await channel.request_analysis({"notes": notes, "duration": duration})
    if features is None:
        return {
            "result": "audio analysis failed (client did not respond — audio may be locked until the user interacts with the page)",
            "mutations": [],
        }
    return {"result": _format_analysis(features), "mutations": []}


def _format_analysis(f: dict[str, Any]) -> str:
    """Render captured audio features as an interpretive summary for the LLM."""
    if f.get("silent"):
        return (
            f"Analysis: SILENCE (RMS {f.get('rms_db', '?')} dBFS over {f.get('duration_ms', '?')} ms). "
            "No audible output — check that oscillators are enabled with volume > 0, "
            "the amp envelope attack isn't extremely long, and the master volume is up."
        )

    centroid = f.get("spectral_centroid_hz")
    if centroid is None:
        brightness = "unknown"
    elif centroid < 800:
        brightness = "dark/warm"
    elif centroid < 2500:
        brightness = "balanced"
    elif centroid < 5000:
        brightness = "bright"
    else:
        brightness = "very bright/harsh"

    bands = f.get("band_db", {})
    clip = "CLIPPING (reduce volume/mix)!" if f.get("clipping") else "no clipping"
    return (
        f"Analysis of {f.get('duration_ms', '?')} ms of audio: "
        f"RMS {f.get('rms_db', '?')} dBFS, peak {f.get('peak_db', '?')} dBFS ({clip}). "
        f"Brightness: centroid {centroid} Hz → {brightness}. "
        f"Bands (dB): sub(20-120Hz) {bands.get('sub', '?')} | "
        f"low-mid(120-800) {bands.get('low_mid', '?')} | "
        f"presence(0.8-4k) {bands.get('presence', '?')} | "
        f"air(4-16k) {bands.get('air', '?')}."
    )


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

        case "snapshot_patch":
            return {
                "result": "Snapshot saved. The current patch can be restored later with restore_snapshot.",
                "mutations": [],
                "snapshot": True,
            }

        case "sequence_pattern":
            return _sequence_pattern(arguments)

        case "sequencer_control":
            action = arguments.get("action")
            if action not in ("start", "stop"):
                return {"result": "sequencer_control requires action='start'|'stop'", "mutations": []}
            payload: dict[str, Any] = {"action": action}
            track = _valid_track_index(arguments.get("track_index"))
            if track is not None:
                payload["track"] = track
                return {
                    "result": f"Sequencer {action} on track {track}.",
                    "mutations": [],
                    "sequencer_control": payload,
                }
            return {
                "result": f"Sequencer {action}.",
                "mutations": [],
                "sequencer_control": payload,
            }

        case "export_audio":
            payload: dict[str, Any] = {}
            if isinstance(arguments.get("bars"), (int, float)):
                payload["bars"] = max(1, min(8, int(arguments["bars"])))
            if isinstance(arguments.get("duration"), (int, float)):
                payload["duration"] = max(0.5, min(30.0, float(arguments["duration"])))
            notes = arguments.get("notes")
            if isinstance(notes, list) and notes:
                payload["notes"] = [
                    int(n) for n in notes[:8] if isinstance(n, (int, float)) and 21 <= n <= 108
                ]
            return {
                "result": "Rendering WAV on the user's device (download starts automatically).",
                "mutations": [],
                "export_audio": payload,
            }

        case "restore_snapshot":
            return {
                "result": "Snapshot restore requested.",
                "mutations": [],
                "restore_snapshot": True,
            }

        case "undo_last_change":
            return {
                "result": "Undo requested.",
                "mutations": [],
                "undo": True,
            }

        case "analyze_audio":
            # Requires the async path (execute_tool_async) with a live client
            # channel — the frontend plays and measures, not the server.
            return {
                "result": "analyze_audio is only available over the streaming WebSocket API.",
                "mutations": [],
            }

        case "create_track":
            name = str(arguments.get("name", "")).strip()[:24]
            payload: dict[str, Any] = {}
            if name:
                payload["name"] = name
            return {
                "result": f"Created track{' ' + name if name else ''} and switched to it (max 8 tracks).",
                "mutations": [],
                "create_track": payload,
            }

        case "select_track":
            track = _valid_track_index(arguments.get("track_index"))
            if track is None:
                return {"result": "select_track requires track_index in [0, 7]", "mutations": []}
            return {
                "result": f"Active track is now {track}. Its synth state comes with the next turn's context.",
                "mutations": [],
                "select_track": track,
            }

        case "set_track_mixer":
            mixer: dict[str, Any] = {}
            track = _valid_track_index(arguments.get("track_index"))
            if track is not None:
                mixer["track"] = track
            if isinstance(arguments.get("volume"), (int, float)):
                mixer["volume"] = max(0.0, min(1.0, float(arguments["volume"])))
            if isinstance(arguments.get("pan"), (int, float)):
                mixer["pan"] = max(-1.0, min(1.0, float(arguments["pan"])))
            if isinstance(arguments.get("mute"), bool):
                mixer["mute"] = arguments["mute"]
            if isinstance(arguments.get("solo"), bool):
                mixer["solo"] = arguments["solo"]
            if len(mixer) == (1 if track is not None else 0):
                return {"result": "set_track_mixer: nothing to set (volume/pan/mute/solo)", "mutations": []}
            return {
                "result": f"Track mixer updated: { {k: v for k, v in mixer.items() if k != 'track'} }",
                "mutations": [],
                "track_mixer": mixer,
            }

        case "set_goals":
            raw_goals = arguments.get("goals") or []
            if not isinstance(raw_goals, list):
                return {"result": "set_goals requires a 'goals' array", "mutations": []}
            goals = [
                {"text": str(g).strip()[:120], "status": "pending"}
                for g in raw_goals
                if str(g).strip()
            ][:10]
            if len(goals) < 2:
                return {"result": "set_goals needs at least 2 goals (simple tasks don't need a goal list)", "mutations": []}
            return {
                "result": (
                    f"Goal list set ({len(goals)} goals). Now execute them IN ORDER: "
                    "update_goal(0, 'in_progress') and start working; mark each done as "
                    "you finish. Do not wait for user input."
                ),
                "mutations": [],
                "goals": goals,
            }

        case "update_goal":
            idx = arguments.get("index")
            status = arguments.get("status")
            if status not in ("in_progress", "done") or not isinstance(idx, int) or isinstance(idx, bool) or idx < 0:
                return {"result": "update_goal requires index>=0 and status in_progress|done", "mutations": []}
            return {
                "result": f"Goal {idx} -> {status}.",
                "mutations": [],
                "goal_update": {"index": idx, "status": status},
            }

        case "propose_plan":
            title = str(arguments.get("title", "")).strip()[:60] or "计划"
            raw_steps = arguments.get("steps") or []
            if not isinstance(raw_steps, list):
                return {"result": "propose_plan requires a 'steps' array", "mutations": []}
            steps = [str(s).strip()[:120] for s in raw_steps if str(s).strip()][:12]
            if not steps:
                return {"result": "propose_plan requires at least one step", "mutations": []}
            return {
                "result": (
                    f"Plan proposed ({len(steps)} steps). WAIT for the user's confirmation "
                    "message before executing — do not call mutation tools yet."
                ),
                "mutations": [],
                "plan": {"title": title, "steps": steps},
            }

        case "update_preferences":
            prefs = arguments.get("preferences")
            if not isinstance(prefs, dict) or not prefs:
                return {"result": "update_preferences requires a 'preferences' object", "mutations": []}
            clean: dict[str, str] = {}
            for k, v in prefs.items():
                key = str(k).strip()[:40]
                if not key:
                    continue
                clean[key] = str(v).strip()[:120]
            if not clean:
                return {"result": "no usable preference entries", "mutations": []}
            return {
                "result": f"Preferences updated: {clean}",
                "mutations": [],
                "preferences": clean,
            }

        case "explain_concept":
            # The LLM's text response IS the explanation; we just pass through
            return {"result": f"[Explaining: {arguments.get('topic', '?')}]", "mutations": []}

        case _:
            return {"result": f"Unknown tool: {tool_name}", "mutations": []}


def _valid_track_index(v: Any) -> int | None:
    """0-based track index or None when absent/invalid."""
    if isinstance(v, bool):
        return None
    if isinstance(v, (int, float)) and float(v).is_integer() and 0 <= int(v) <= 7:
        return int(v)
    return None


def _sequence_pattern(args: dict) -> dict:
    """Validate a sequencer pattern from the LLM; invalid notes are skipped."""
    steps = args.get("steps")
    if steps not in (16, 32):
        return {"result": "sequence_pattern requires steps to be 16 or 32", "mutations": []}

    raw_notes = args.get("notes") or []
    if not isinstance(raw_notes, list):
        return {"result": "'notes' must be an array", "mutations": []}

    valid: list[dict[str, Any]] = []
    skipped = 0
    for item in raw_notes[:64]:
        if not isinstance(item, dict):
            skipped += 1
            continue
        try:
            note = int(item["note"])
            start = int(item["start"])
            duration = int(item.get("duration", 1))
            velocity = int(item.get("velocity", 100))
        except (KeyError, TypeError, ValueError):
            skipped += 1
            continue
        if not (21 <= note <= 108 and 0 <= start < steps and 1 <= duration <= 32 and 1 <= velocity <= 127):
            skipped += 1
            continue
        valid.append({"note": note, "start": start, "duration": duration, "velocity": velocity})

    if not valid:
        return {"result": "no valid notes in pattern (check note/start ranges)", "mutations": []}

    result = f"Pattern written: {steps} steps, {len(valid)} notes"
    track = _valid_track_index(args.get("track_index"))
    if track is not None:
        result += f" on track {track}"
    if skipped:
        result += f" ({skipped} invalid skipped)"
    payload: dict[str, Any] = {"steps": steps, "notes": valid}
    if track is not None:
        payload["track"] = track
    name = args.get("name")
    if isinstance(name, str) and name.strip():
        payload["name"] = name.strip()[:40]
    return {"result": result + ".", "mutations": [], "sequencer_pattern": payload}


def _set_params(args: dict) -> dict:
    """Batch parameter set — validate every entry against the spec registry."""
    entries = args.get("params") or []
    if not isinstance(entries, list) or not entries:
        return {"result": "set_params requires a non-empty 'params' array", "mutations": []}

    track = _valid_track_index(args.get("track_index"))
    raw: list[dict[str, Any]] = []
    shape_errors: list[str] = []
    for i, e in enumerate(entries):
        if not isinstance(e, dict) or "path" not in e or "value" not in e:
            shape_errors.append(f"params[{i}] must be an object with 'path' and 'value'")
            continue
        mut = {"path": str(e["path"]), "value": e["value"]}
        if track is not None:
            mut["track"] = track
        raw.append(mut)

    valid, errors = validate_mutations(raw)
    errors = shape_errors + errors

    summary = f"Applied {len(valid)} parameter(s)"
    summary += f" on track {track}." if track is not None else "."
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

    seq = state.get("sequencer")
    if isinstance(seq, dict):
        playing = "PLAYING" if seq.get("playing") else "stopped"
        notes = seq.get("notes") or []
        lines.append(f"Sequencer: {playing} | {seq.get('steps', 16)} steps | {len(notes)} notes")
        if notes:
            brief = " ".join(
                f"{_NOTE_NAMES[n['note'] % 12]}{n['note'] // 12 - 1}@{n['start']}"
                for n in notes[:16]
                if isinstance(n, dict) and "note" in n and "start" in n
            )
            if brief:
                lines.append(f"  notes: {brief}{' …' if len(notes) > 16 else ''}")

    prefs = state.get("preferences")
    if isinstance(prefs, dict) and prefs:
        items = "; ".join(f"{k}={v}" for k, v in list(prefs.items())[:12])
        lines.append(f"用户偏好: {items}")

    tracks = state.get("tracks")
    if isinstance(tracks, list) and tracks:
        active_idx = state.get("activeTrack", 0)
        lines.append("Tracks:")
        for t in tracks:
            if not isinstance(t, dict):
                continue
            flags = []
            if t.get("active"):
                flags.append("ACTIVE")
            if t.get("playing"):
                flags.append("PLAYING")
            if t.get("mute"):
                flags.append("MUTED")
            if t.get("solo"):
                flags.append("SOLO")
            flag_str = f" [{' '.join(flags)}]" if flags else ""
            lines.append(
                f"  [{t.get('index', '?')}] {t.get('name', '?')}{flag_str} "
                f"vol={t.get('volume', 0):.2f} pan={t.get('pan', 0):.2f} "
                f"pattern={t.get('patternNotes', 0)} notes"
            )
        if not any(isinstance(t, dict) and t.get("active") for t in tracks):
            lines.append(f"  (activeTrack index: {active_idx})")

    return "\n".join(lines)
