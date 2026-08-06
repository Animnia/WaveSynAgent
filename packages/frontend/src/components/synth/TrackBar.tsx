import { useTracksStore, MAX_TRACKS } from '@/stores/tracksStore';

/**
 * Track rail — select the active track, per-track play, mute/solo,
 * mini volume/pan, add/remove tracks. Each track owns an independent
 * synth engine + pattern.
 */
export default function TrackBar() {
  const tracks = useTracksStore((s) => s.tracks);
  const activeTrackId = useTracksStore((s) => s.activeTrackId);
  const selectTrack = useTracksStore((s) => s.selectTrack);
  const createTrack = useTracksStore((s) => s.createTrack);
  const deleteTrack = useTracksStore((s) => s.deleteTrack);
  const renameTrack = useTracksStore((s) => s.renameTrack);
  const setMixerParams = useTracksStore((s) => s.setMixerParams);
  const toggleTrackEnabled = useTracksStore((s) => s.toggleTrackEnabled);
  const toggleTrack = useTracksStore((s) => s.toggleTrack);

  return (
    <div className="flex items-stretch gap-2 px-3 py-2 border-b border-border-default bg-bg-secondary overflow-x-auto">
      {tracks.map((t, i) => {
        const isActive = t.id === activeTrackId;
        return (
          <div
            key={t.id}
            onClick={() => selectTrack(t.id)}
            className={`flex items-center gap-2 px-2.5 py-1.5 rounded border cursor-pointer select-none transition-colors flex-shrink-0 whitespace-nowrap ${
              isActive
                ? 'border-border-active bg-bg-tertiary'
                : 'border-border-default bg-bg-primary hover:border-border-active/50'
            } ${t.enabled ? '' : 'opacity-50'}`}
          >
            {/* Power dot — click to enable/disable the track */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                toggleTrackEnabled(t.id);
              }}
              title={t.enabled ? 'Disable track (silence + stop)' : 'Enable track'}
              aria-label={`${t.enabled ? 'Disable' : 'Enable'} ${t.name}`}
              className={`w-2 h-2 rounded-full flex-shrink-0 transition-colors ${
                t.enabled ? 'bg-text-primary' : 'bg-bg-tertiary border border-text-muted'
              }`}
            />
            <input
              value={t.name}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => renameTrack(t.id, e.target.value)}
              className="w-16 bg-transparent text-[11px] text-text-primary outline-none border-b border-transparent focus:border-border-active"
              title={`Track ${i + 1} (click to rename)`}
            />

            {/* Play */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                void toggleTrack(t.id);
              }}
              disabled={!t.enabled || (t.pattern.notes.length === 0 && !t.playing)}
              title={
                !t.enabled
                  ? 'Track disabled'
                  : t.pattern.notes.length === 0
                    ? '(no pattern)'
                    : 'Play/stop this track\'s sequencer'
              }
              className={`text-[10px] w-5 h-5 rounded border transition-colors disabled:opacity-25 ${
                t.playing
                  ? 'bg-accent-cyan/20 text-accent-cyan border-accent-cyan/50'
                  : 'bg-bg-tertiary text-text-muted border-border-default hover:text-text-secondary'
              }`}
            >
              {t.playing ? '■' : '▶'}
            </button>

            {/* Mute / Solo */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                setMixerParams(t.id, { mute: !t.mixer.mute });
              }}
              className={`text-[9px] w-5 h-5 rounded border transition-colors ${
                t.mixer.mute
                  ? 'bg-accent-red/20 text-accent-red border-accent-red/50'
                  : 'bg-bg-tertiary text-text-muted border-border-default hover:text-text-secondary'
              }`}
            >
              M
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                setMixerParams(t.id, { solo: !t.mixer.solo });
              }}
              className={`text-[9px] w-5 h-5 rounded border transition-colors ${
                t.mixer.solo
                  ? 'bg-accent-orange/20 text-accent-orange border-accent-orange/50'
                  : 'bg-bg-tertiary text-text-muted border-border-default hover:text-text-secondary'
              }`}
            >
              S
            </button>

            {/* Mini volume */}
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={t.mixer.volume}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => setMixerParams(t.id, { volume: parseFloat(e.target.value) })}
              className="w-12"
              title={`Volume ${(t.mixer.volume * 100).toFixed(0)}%`}
            />

            {/* Mini pan */}
            <input
              type="range"
              min={-1}
              max={1}
              step={0.01}
              value={t.mixer.pan}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => setMixerParams(t.id, { pan: parseFloat(e.target.value) })}
              onDoubleClick={(e) => {
                e.stopPropagation();
                setMixerParams(t.id, { pan: 0 });
              }}
              className="w-10"
              title={`Pan ${t.mixer.pan.toFixed(2)} (double-click to center)`}
            />

            {/* Delete */}
            {tracks.length > 1 && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  deleteTrack(t.id);
                }}
                className="text-text-muted hover:text-accent-red text-[10px] px-0.5"
                aria-label={`Delete ${t.name}`}
              >
                ✕
              </button>
            )}
          </div>
        );
      })}

      {tracks.length < MAX_TRACKS && (
        <button
          onClick={() => createTrack()}
          className="px-3 py-1.5 text-xs rounded border border-dashed border-border-default text-text-muted hover:border-border-active hover:text-text-secondary transition-colors flex-shrink-0"
        >
          + Track
        </button>
      )}
    </div>
  );
}
