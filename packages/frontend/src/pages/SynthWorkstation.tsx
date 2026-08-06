import { useEffect, useState } from 'react';
import { useSynthStore } from '@/stores/synthStore';
import { getAudioEngine } from '@/engine/registry';
import OscillatorPanel from '@/components/synth/OscillatorPanel';
import FilterPanel from '@/components/synth/FilterPanel';
import EnvelopePanel from '@/components/synth/EnvelopePanel';
import LFOPanel from '@/components/synth/LFOPanel';
import EffectsPanel from '@/components/synth/EffectsPanel';
import MasterPanel from '@/components/synth/MasterPanel';
import VirtualKeyboard from '@/components/synth/VirtualKeyboard';
import ModMatrixPanel from '@/components/synth/ModMatrixPanel';
import Oscilloscope from '@/visualizers/Oscilloscope';
import SpectrumAnalyzer from '@/visualizers/SpectrumAnalyzer';
import AgentPanel from '@/components/agent/AgentPanel';
import { useAgentStore } from '@/stores/agentStore';
import PresetBrowser from '@/components/presets/PresetBrowser';
import { usePresetStore } from '@/stores/presetStore';
import SequencerPanel from '@/components/synth/SequencerPanel';
import TrackBar from '@/components/synth/TrackBar';
import { useTracksStore } from '@/stores/tracksStore';
import { useMidiStore } from '@/stores/midiStore';
import { exportCurrentPatch } from '@/utils/export';

export default function SynthWorkstation() {
  const synthState = useSynthStore((s) => s.state);
  const toggleAgent = useAgentStore((s) => s.togglePanel);
  const agentOpen = useAgentStore((s) => s.panelOpen);
  const togglePresetBrowser = usePresetStore((s) => s.toggleBrowser);
  const undo = useSynthStore((s) => s.undo);
  const redo = useSynthStore((s) => s.redo);
  const canUndo = useSynthStore((s) => s.past.length > 0);
  const canRedo = useSynthStore((s) => s.future.length > 0);
  const sequencerOpen = useTracksStore((s) => s.sequencerPanelOpen);
  const sequencerPlaying = useTracksStore(
    (s) => s.tracks.find((t) => t.id === s.activeTrackId)?.playing ?? false,
  );
  const toggleSequencer = useTracksStore((s) => s.toggleSequencerPanel);
  const midiSupported = useMidiStore((s) => s.supported);
  const midiEnabled = useMidiStore((s) => s.enabled);
  const midiInputs = useMidiStore((s) => s.inputs);
  const midiInit = useMidiStore((s) => s.init);
  const setMidiEnabled = useMidiStore((s) => s.setEnabled);
  const [exporting, setExporting] = useState(false);

  // Auto-init MIDI on first mount (no-op when unsupported).
  useEffect(() => {
    if (midiSupported) void midiInit();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleExport = async () => {
    setExporting(true);
    try {
      await exportCurrentPatch();
    } catch (err) {
      console.error('Export failed:', err);
    } finally {
      setExporting(false);
    }
  };

  // Sync engine on mount
  useEffect(() => {
    const engine = getAudioEngine();
    engine.applyState(synthState);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Global undo/redo shortcuts (Ctrl/Cmd+Z, Shift+Ctrl/Cmd+Z, Ctrl+Y).
  // VirtualKeyboard already ignores chorded keys, so no conflict there.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return; // don't hijack text editing (e.g. the agent chat box)
      }
      const key = e.key.toLowerCase();
      if (key === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if (key === 'y') {
        e.preventDefault();
        redo();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [undo, redo]);

  return (
    <div className="h-full flex flex-col bg-bg-primary">
      {/* ===== Top Bar ===== */}
      <header className="flex items-center justify-between px-4 py-2 border-b border-border-default bg-bg-secondary">
        <div className="flex items-center gap-3">
          <h1 className="text-sm font-bold text-accent-cyan tracking-wider">
            WAVESYN<span className="text-accent-purple">AGENT</span>
          </h1>
          <span className="text-[10px] text-text-muted bg-bg-tertiary px-2 py-0.5 rounded">
            v0.1
          </span>
        </div>
        <MasterPanel />
        <div className="flex items-center gap-2">
          <button
            onClick={undo}
            disabled={!canUndo}
            title="撤销 (Ctrl+Z)"
            className="px-2 py-1.5 text-xs bg-bg-tertiary text-text-secondary rounded border border-border-default hover:border-border-active transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          >
            ↩ Undo
          </button>
          <button
            onClick={redo}
            disabled={!canRedo}
            title="重做 (Ctrl+Shift+Z / Ctrl+Y)"
            className="px-2 py-1.5 text-xs bg-bg-tertiary text-text-secondary rounded border border-border-default hover:border-border-active transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          >
            ↪ Redo
          </button>
          {midiSupported && (
            <button
              onClick={() => setMidiEnabled(!midiEnabled)}
              title={
                midiInputs.length > 0
                  ? `MIDI 输入: ${midiInputs.map((i) => i.name).join(', ')}`
                  : 'MIDI 已启用，未检测到设备'
              }
              className={`px-3 py-1.5 text-xs rounded border transition-colors ${
                midiEnabled && midiInputs.length > 0
                  ? 'bg-accent-cyan/20 text-accent-cyan border-accent-cyan/50'
                  : 'bg-bg-tertiary text-text-secondary border-border-default hover:border-border-active'
              }`}
            >
              MIDI{midiInputs.length > 0 ? `:${midiInputs.length}` : ''}
            </button>
          )}
          <button
            onClick={() => void handleExport()}
            disabled={exporting}
            title="将当前音色（或序列器 loop）渲染为 WAV 并下载"
            className="px-3 py-1.5 text-xs bg-bg-tertiary text-text-secondary rounded border border-border-default hover:border-border-active transition-colors disabled:opacity-30"
          >
            {exporting ? '⏺ Rendering…' : '⬇ Export'}
          </button>
          <button
            onClick={toggleSequencer}
            className={`px-3 py-1.5 text-xs rounded border transition-colors ${
              sequencerOpen
                ? 'bg-accent-cyan/20 text-accent-cyan border-accent-cyan/50'
                : 'bg-bg-tertiary text-text-secondary border-border-default hover:border-border-active'
            }`}
          >
            {sequencerPlaying ? '◉ ' : ''}Seq
          </button>
          <button
            onClick={togglePresetBrowser}
            className="px-3 py-1.5 text-xs bg-bg-tertiary text-text-secondary rounded border border-border-default hover:border-border-active transition-colors"
          >
            Presets
          </button>
          <button
            className={`px-3 py-1.5 text-xs rounded border transition-colors ${
              agentOpen
                ? 'bg-accent-purple text-white border-accent-purple'
                : 'bg-accent-purple/20 text-accent-purple border-accent-purple/30 hover:bg-accent-purple/30'
            }`}
            onClick={toggleAgent}
          >
            AI Agent
          </button>
        </div>
      </header>

      {/* ===== Track Bar ===== */}
      <TrackBar />

      {/* ===== Main Content ===== */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left: Oscillators */}
        <div className="w-64 border-r border-border-default p-3 overflow-y-auto space-y-2">
          <OscillatorPanel index={0} />
          <OscillatorPanel index={1} />
          <OscillatorPanel index={2} />
        </div>

        {/* Center: Filter + Envelopes + LFOs + Visualizers */}
        <div className="flex-1 p-3 overflow-y-auto">
          {/* Visualizers */}
          <div className="flex gap-3 mb-3">
            <div className="flex-1">
              <span className="text-[10px] text-text-muted uppercase tracking-wider mb-1 block">
                Waveform
              </span>
              <Oscilloscope width={400} height={80} />
            </div>
            <div className="flex-1">
              <span className="text-[10px] text-text-muted uppercase tracking-wider mb-1 block">
                Spectrum
              </span>
              <SpectrumAnalyzer width={400} height={80} />
            </div>
          </div>

          {/* Filter + Envelopes row */}
          <div className="grid grid-cols-3 gap-3 mb-3">
            <FilterPanel />
            <EnvelopePanel type="amp" />
            <EnvelopePanel type="filter" />
          </div>

          {/* LFOs */}
          <div className="grid grid-cols-2 gap-3">
            <LFOPanel index={1} />
            <LFOPanel index={2} />
          </div>

          {/* Mod Matrix */}
          <div className="mt-3">
            <ModMatrixPanel />
          </div>
        </div>

        {/* Right: Effects */}
        <div className="w-52 border-l border-border-default p-3 overflow-y-auto">
          <span className="text-[10px] text-text-muted uppercase tracking-wider mb-2 block">
            Effects
          </span>
          <EffectsPanel />
        </div>

        {/* Agent Panel (right side drawer) */}
        <AgentPanel />
      </div>

      {/* ===== Bottom: Sequencer (collapsible) + Keyboard ===== */}
      {sequencerOpen && <SequencerPanel />}
      <div className="border-t border-border-default bg-bg-secondary p-2">
        <VirtualKeyboard startOctave={3} octaves={3} />
      </div>

      {/* Modal: Preset browser */}
      <PresetBrowser />
    </div>
  );
}
