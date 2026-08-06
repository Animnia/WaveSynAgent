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
import Dropdown from '@/components/common/Dropdown';
import SavePresetDialog from '@/components/presets/SavePresetDialog';

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

  const handleExport = async (bars?: number) => {
    setExporting(true);
    try {
      await exportCurrentPatch(bars ? { bars } : {});
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
            title="Undo (Ctrl+Z)"
            className="px-2 py-1.5 text-xs bg-bg-tertiary text-text-secondary rounded border border-border-default hover:border-border-active transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          >
            Undo
          </button>
          <button
            onClick={redo}
            disabled={!canRedo}
            title="Redo (Ctrl+Shift+Z / Ctrl+Y)"
            className="px-2 py-1.5 text-xs bg-bg-tertiary text-text-secondary rounded border border-border-default hover:border-border-active transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          >
            Redo
          </button>
          {midiSupported && (
            <Dropdown
              label={`MIDI${midiEnabled && midiInputs.length > 0 ? ` · ${midiInputs.length}` : ''}`}
              active={midiEnabled && midiInputs.length > 0}
              title="MIDI input"
              items={[
                {
                  label: midiEnabled ? 'Disable MIDI input' : 'Enable MIDI input',
                  onClick: () => setMidiEnabled(!midiEnabled),
                },
                { label: 'Inputs', header: true },
                ...(midiInputs.length > 0
                  ? midiInputs.map((i) => ({ label: i.name, disabled: true }))
                  : [{ label: 'No devices detected', disabled: true }]),
              ]}
            />
          )}
          <Dropdown
            label={exporting ? 'Exporting…' : 'Export'}
            disabled={exporting}
            title="Render audio to a WAV file"
            items={[
              { label: 'Export mix — 2 bars', onClick: () => void handleExport() },
              { label: 'Export mix — 4 bars', onClick: () => void handleExport(4) },
              { label: 'Export mix — 8 bars', onClick: () => void handleExport(8) },
            ]}
          />
          <button
            onClick={toggleSequencer}
            className={`px-3 py-1.5 text-xs rounded border transition-colors ${
              sequencerOpen
                ? 'bg-text-primary/10 text-text-primary border-border-active'
                : 'bg-bg-tertiary text-text-secondary border-border-default hover:border-border-active'
            }`}
          >
            Seq
          </button>
          <Dropdown
            label="Presets"
            title="Preset library"
            items={[
              { label: 'Browse presets…', onClick: togglePresetBrowser },
              {
                label: 'Save current as preset…',
                onClick: () => usePresetStore.getState().toggleSaveDialog(),
              },
            ]}
          />
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
      {/* Save dialog lives at page level so the header Presets menu can open it */}
      <SavePresetDialog />
    </div>
  );
}
