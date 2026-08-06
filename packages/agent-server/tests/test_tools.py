"""Tool executor tests — the agent's effectors must be strict and safe."""

from __future__ import annotations

import pytest

from app.tools.param_specs import match_spec, validate_param
from app.tools.synth_tools import SYNTH_TOOLS, execute_tool, execute_tool_async

# ── Registry validation ──


class TestParamSpecs:
    def test_wildcard_match(self):
        assert match_spec("oscillators.0.volume") is not None
        assert match_spec("oscillators.2.type") is not None
        assert match_spec("oscillators.0.volume.extra") is None
        assert match_spec("oscillators.volume") is None

    def test_range_rejection(self):
        _, err = validate_param("filter.cutoff", 99999)
        assert err and "between" in err
        value, err = validate_param("filter.cutoff", 2500)
        assert err is None and value == 2500

    def test_integer_coercion(self):
        value, err = validate_param("master.bpm", 128.4)
        assert err is None and value == 128

    def test_enum_and_boolean(self):
        assert validate_param("filter.type", "bandpass")[1] is None
        assert validate_param("filter.type", "banana")[1] is not None
        assert validate_param("lfo1.enabled", True)[1] is None
        assert validate_param("lfo1.enabled", "true")[1] is not None

    def test_prototype_pollution_guard(self):
        _, err = validate_param("oscillators.0.__proto__", {})
        assert err and "forbidden" in err


# ── set_params (batch tool) ──


class TestSetParams:
    def test_batch_applies_valid(self, synth_state):
        result = execute_tool(
            "set_params",
            {
                "params": [
                    {"path": "filter.cutoff", "value": 3000},
                    {"path": "oscillators.0.volume", "value": 0.5},
                    {"path": "lfo1.enabled", "value": True},
                ]
            },
            synth_state,
        )
        assert len(result["mutations"]) == 3
        assert "Applied 3" in result["result"]

    def test_partial_rejection_keeps_valid(self, synth_state):
        result = execute_tool(
            "set_params",
            {
                "params": [
                    {"path": "filter.cutoff", "value": -5},  # out of range
                    {"path": "filter.resonance", "value": 0.5},  # ok
                    {"path": "evil.path", "value": 1},  # unknown
                ]
            },
            synth_state,
        )
        assert result["mutations"] == [{"path": "filter.resonance", "value": 0.5}]
        assert "Rejected" in result["result"]
        assert "evil.path" in result["result"]

    def test_empty_params_rejected(self, synth_state):
        result = execute_tool("set_params", {"params": []}, synth_state)
        assert result["mutations"] == []


# ── Granular tool hardening ──


class TestGranularTools:
    def test_arbitrary_key_passthrough_blocked(self, synth_state):
        result = execute_tool(
            "set_oscillator",
            {"index": 0, "type": "square", "__proto__": {"polluted": True}},
            synth_state,
        )
        paths = [m["path"] for m in result["mutations"]]
        assert paths == ["oscillators.0.type"]

    def test_out_of_range_rejected_despite_schema_bypass(self, synth_state):
        result = execute_tool("set_filter", {"cutoff": 500000}, synth_state)
        assert result["mutations"] == []
        assert "Rejected" in result["result"]

    def test_mod_route_operations(self, synth_state):
        add = execute_tool(
            "set_mod_route",
            {"operation": "add", "source": "lfo1", "destination": "filter.cutoff", "depth": 0.4},
            synth_state,
        )
        assert add["mutations"][0]["path"] == "modulation.add"

        rm = execute_tool("set_mod_route", {"operation": "remove", "id": "abc"}, synth_state)
        assert rm["mutations"] == [{"path": "modulation.remove", "value": "abc"}]

        bad = execute_tool("set_mod_route", {"operation": "remove"}, synth_state)
        assert bad["mutations"] == []

    def test_effect_chain_requires_full_permutation(self, synth_state):
        bad = execute_tool("reorder_effect_chain", {"order": ["reverb", "delay"]}, synth_state)
        assert bad["mutations"] == []
        good_order = [
            "distortion", "bitCrusher", "compressor", "eq3", "chorus",
            "phaser", "delay", "reverb", "stereoWidener",
        ]
        good = execute_tool("reorder_effect_chain", {"order": good_order}, synth_state)
        assert good["mutations"] == [{"path": "effectChain", "value": good_order}]

    def test_play_notes_passthrough(self, synth_state):
        result = execute_tool(
            "play_notes",
            {"notes": [60, 64, 67], "mode": "sequence", "interval": 0.3},
            synth_state,
        )
        assert result["play"]["mode"] == "sequence"
        assert result["play"]["interval"] == 0.3

    def test_side_effect_tools(self, synth_state):
        assert execute_tool("snapshot_patch", {}, synth_state).get("snapshot") is True
        assert execute_tool("restore_snapshot", {}, synth_state).get("restore_snapshot") is True
        assert execute_tool("undo_last_change", {}, synth_state).get("undo") is True
        sp = execute_tool("save_preset", {"name": "Test Pad", "tags": ["pad"]}, synth_state)
        assert sp["save_preset"]["name"] == "Test Pad"


# ── analyze_audio ──


class _FakeChannel:
    def __init__(self, features):
        self.features = features

    async def request_analysis(self, payload):
        return self.features


class TestAnalyzeAudio:
    @pytest.mark.asyncio
    async def test_formats_features(self, synth_state):
        channel = _FakeChannel(
            {
                "rms_db": -15.0,
                "peak_db": -3.0,
                "clipping": False,
                "spectral_centroid_hz": 600,
                "band_db": {"sub": -20, "low_mid": -15, "presence": -25, "air": -40},
                "silent": False,
                "duration_ms": 1500,
            }
        )
        result = await execute_tool_async("analyze_audio", {"duration": 2.0}, synth_state, channel)
        assert "dark/warm" in result["result"]
        assert "no clipping" in result["result"]

    @pytest.mark.asyncio
    async def test_no_channel_degrades(self, synth_state):
        result = await execute_tool_async("analyze_audio", {}, synth_state, None)
        assert "unavailable" in result["result"]

    def test_sync_fallback_message(self, synth_state):
        result = execute_tool("analyze_audio", {}, synth_state)
        assert "streaming WebSocket" in result["result"]


def test_tool_count_and_unique_names():
    names = [t["function"]["name"] for t in SYNTH_TOOLS]
    assert len(names) == len(set(names))
    assert "set_params" in names and "analyze_audio" in names


# ── sequencer tools ──


class TestSequencerTools:
    def test_valid_pattern(self, synth_state):
        result = execute_tool(
            "sequence_pattern",
            {
                "steps": 16,
                "notes": [
                    {"note": 36, "start": 0},
                    {"note": 36, "start": 4, "duration": 2},
                    {"note": 43, "start": 8, "velocity": 90},
                ],
            },
            synth_state,
        )
        pattern = result["sequencer_pattern"]
        assert pattern["steps"] == 16
        assert len(pattern["notes"]) == 3
        # defaults filled
        assert pattern["notes"][0]["duration"] == 1
        assert pattern["notes"][0]["velocity"] == 100

    def test_invalid_notes_skipped(self, synth_state):
        result = execute_tool(
            "sequence_pattern",
            {
                "steps": 16,
                "notes": [
                    {"note": 60, "start": 0},
                    {"note": 200, "start": 4},    # out of MIDI range
                    {"note": 60, "start": 99},    # beyond pattern length
                    "garbage",
                ],
            },
            synth_state,
        )
        pattern = result["sequencer_pattern"]
        assert len(pattern["notes"]) == 1
        assert "skipped" in result["result"]

    def test_all_invalid_rejected(self, synth_state):
        result = execute_tool(
            "sequence_pattern",
            {"steps": 16, "notes": [{"note": 999, "start": 0}]},
            synth_state,
        )
        assert "sequencer_pattern" not in result

    def test_bad_steps_rejected(self, synth_state):
        result = execute_tool(
            "sequence_pattern",
            {"steps": 24, "notes": [{"note": 60, "start": 0}]},
            synth_state,
        )
        assert "sequencer_pattern" not in result

    def test_sequencer_control(self, synth_state):
        start = execute_tool("sequencer_control", {"action": "start"}, synth_state)
        assert start["sequencer_control"] == {"action": "start"}
        stop = execute_tool("sequencer_control", {"action": "stop"}, synth_state)
        assert stop["sequencer_control"] == {"action": "stop"}
        bad = execute_tool("sequencer_control", {"action": "explode"}, synth_state)
        assert "sequencer_control" not in bad

    def test_sequencer_control_track_targeting(self, synth_state):
        result = execute_tool(
            "sequencer_control", {"action": "start", "track_index": 2}, synth_state
        )
        assert result["sequencer_control"] == {"action": "start", "track": 2}

    def test_sequence_pattern_track_targeting(self, synth_state):
        result = execute_tool(
            "sequence_pattern",
            {"steps": 16, "notes": [{"note": 60, "start": 0}], "track_index": 1},
            synth_state,
        )
        assert result["sequencer_pattern"]["track"] == 1


class TestTrackTools:
    def test_set_params_track_index_propagates(self, synth_state):
        result = execute_tool(
            "set_params",
            {
                "track_index": 3,
                "params": [{"path": "filter.cutoff", "value": 800}],
            },
            synth_state,
        )
        assert result["mutations"] == [{"path": "filter.cutoff", "value": 800, "track": 3}]

    def test_set_params_invalid_track_index_dropped(self, synth_state):
        result = execute_tool(
            "set_params",
            {"track_index": 99, "params": [{"path": "filter.cutoff", "value": 800}]},
            synth_state,
        )
        # Invalid index falls back to active-track targeting (no track field)
        assert result["mutations"] == [{"path": "filter.cutoff", "value": 800}]

    def test_create_track(self, synth_state):
        result = execute_tool("create_track", {"name": "Bass"}, synth_state)
        assert result["create_track"] == {"name": "Bass"}
        anon = execute_tool("create_track", {}, synth_state)
        assert anon["create_track"] == {}

    def test_select_track(self, synth_state):
        ok = execute_tool("select_track", {"track_index": 2}, synth_state)
        assert ok["select_track"] == 2
        bad = execute_tool("select_track", {"track_index": 99}, synth_state)
        assert "select_track" not in bad

    def test_set_track_mixer(self, synth_state):
        result = execute_tool(
            "set_track_mixer",
            {"track_index": 1, "volume": 0.5, "pan": 2.0, "solo": True},
            synth_state,
        )
        # pan clamped to [-1, 1]; track + solo pass through
        assert result["track_mixer"] == {"track": 1, "volume": 0.5, "pan": 1.0, "solo": True}

    def test_set_track_mixer_nothing_to_set(self, synth_state):
        result = execute_tool("set_track_mixer", {}, synth_state)
        assert "track_mixer" not in result
        assert "nothing to set" in result["result"]


class TestExportAudio:
    def test_defaults(self, synth_state):
        result = execute_tool("export_audio", {}, synth_state)
        assert result["export_audio"] == {}

    def test_clamps_and_sanitizes(self, synth_state):
        result = execute_tool(
            "export_audio",
            {"bars": 99, "duration": -5, "notes": [60, 999, "x", 64]},
            synth_state,
        )
        payload = result["export_audio"]
        assert payload["bars"] == 8
        assert payload["duration"] == 0.5
        assert payload["notes"] == [60, 64]


class TestProposePlan:
    def test_plan_payload(self, synth_state):
        result = execute_tool(
            "propose_plan",
            {"title": "分层铺底", "steps": ["新建 Pad 轨", "设计音色", "写 pattern"]},
            synth_state,
        )
        assert result["plan"] == {
            "title": "分层铺底",
            "steps": ["新建 Pad 轨", "设计音色", "写 pattern"],
        }
        assert "WAIT" in result["result"]  # agent told to pause for confirmation

    def test_plan_requires_steps(self, synth_state):
        result = execute_tool("propose_plan", {"title": "x", "steps": []}, synth_state)
        assert "plan" not in result

    def test_plan_truncates_and_sanitizes(self, synth_state):
        result = execute_tool(
            "propose_plan",
            {"title": "t" * 100, "steps": ["  ok  ", "", "  ", "fine"]},
            synth_state,
        )
        assert len(result["plan"]["title"]) == 60
        assert result["plan"]["steps"] == ["ok", "fine"]


class TestGoalTools:
    def test_set_goals(self, synth_state):
        result = execute_tool(
            "set_goals",
            {"goals": ["设计 bass 音色", "写 bassline", "验证混音"]},
            synth_state,
        )
        assert result["goals"] == [
            {"text": "设计 bass 音色", "status": "pending"},
            {"text": "写 bassline", "status": "pending"},
            {"text": "验证混音", "status": "pending"},
        ]
        assert "IN ORDER" in result["result"]

    def test_set_goals_needs_two(self, synth_state):
        result = execute_tool("set_goals", {"goals": ["只做一件事"]}, synth_state)
        assert "goals" not in result

    def test_update_goal(self, synth_state):
        ok = execute_tool("update_goal", {"index": 1, "status": "done"}, synth_state)
        assert ok["goal_update"] == {"index": 1, "status": "done"}
        bad = execute_tool("update_goal", {"index": -1, "status": "done"}, synth_state)
        assert "goal_update" not in bad
        bad2 = execute_tool("update_goal", {"index": 0, "status": "maybe"}, synth_state)
        assert "goal_update" not in bad2
