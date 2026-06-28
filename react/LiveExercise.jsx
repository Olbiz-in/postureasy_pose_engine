// Drop-in live-tracking view: webcam + skeleton overlay + minimal HUD.
// Headless consumers can use `useLiveExercise` directly instead.

import { useLiveExercise } from './useLiveExercise.js';

const WRAP_STYLE = {
  position: 'relative',
  width: '100%',
  height: '100%',
  overflow: 'hidden',
  background: '#0b1120',
};

const MEDIA_STYLE = {
  position: 'absolute',
  inset: 0,
  width: '100%',
  height: '100%',
  objectFit: 'cover',
};

const OVERLAY_STYLE = {
  position: 'absolute',
  inset: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  textAlign: 'center',
  color: '#e2e8f0',
  padding: '24px',
  font: '500 15px system-ui, sans-serif',
};

export default function LiveExercise({
  exerciseName,
  active = true,
  mirrored = true,
  voice = false,
  onRepCountChange,
  onStateChange,
  showHud = true,
  className,
}) {
  const { videoRef, canvasRef, status, error, state } = useLiveExercise({
    exerciseName,
    active,
    mirrored,
    voice,
    onRepCountChange,
    onStateChange,
  });

  const transform = mirrored ? 'scaleX(-1)' : 'none';

  return (
    <div className={className} style={WRAP_STYLE}>
      <video ref={videoRef} playsInline muted style={{ ...MEDIA_STYLE, transform }} />
      <canvas ref={canvasRef} style={{ ...MEDIA_STYLE, transform }} />

      {status === 'loading' && <div style={OVERLAY_STYLE}>Loading camera & pose model…</div>}
      {status === 'unsupported' && (
        <div style={OVERLAY_STYLE}>
          Live tracking isn’t available for this exercise yet. Use the timer to log it manually.
        </div>
      )}
      {status === 'error' && (
        <div style={OVERLAY_STYLE}>
          Couldn’t start the camera.<br />{error}<br />
          <small>Check camera permissions and that no other app is using it.</small>
        </div>
      )}

      {showHud && status === 'running' && (
        <Hud state={state} />
      )}
    </div>
  );
}

function Hud({ state }) {
  const topCue = state.cues?.[0];
  const cueColor = { ok: '#22d3a6', info: '#38bdf8', warn: '#f59e0b', bad: '#ef4444' }[topCue?.level] || '#e2e8f0';
  return (
    <>
      <div style={{ position: 'absolute', top: 16, left: 16, display: 'flex', gap: 12 }}>
        <Badge label="Reps" value={state.repCount} />
        <Badge label="Form" value={`${state.formScore}`} suffix="/100" />
      </div>

      <div style={{ position: 'absolute', left: 16, right: 16, bottom: 16 }}>
        <div style={{
          height: 8, borderRadius: 999, background: 'rgba(255,255,255,0.18)', overflow: 'hidden', marginBottom: 10,
        }}>
          <div style={{ height: '100%', width: `${Math.round((state.progress || 0) * 100)}%`, background: '#22d3a6', transition: 'width 80ms linear' }} />
        </div>
        {topCue && (
          <div style={{
            display: 'inline-block', padding: '8px 14px', borderRadius: 10,
            background: 'rgba(11,17,32,0.72)', color: cueColor, font: '600 14px system-ui, sans-serif',
          }}>
            {topCue.text}
          </div>
        )}
      </div>
    </>
  );
}

function Badge({ label, value, suffix }) {
  return (
    <div style={{
      padding: '8px 14px', borderRadius: 12, background: 'rgba(11,17,32,0.72)',
      color: '#e2e8f0', font: '500 12px system-ui, sans-serif', minWidth: 64,
    }}>
      <div style={{ opacity: 0.7, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, lineHeight: 1.1 }}>
        {value}{suffix && <span style={{ fontSize: 12, opacity: 0.6 }}> {suffix}</span>}
      </div>
    </div>
  );
}
