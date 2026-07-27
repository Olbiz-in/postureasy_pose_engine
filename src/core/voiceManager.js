// TTS voice manager — ported from fitness_posture useVoiceManager.
// Cooldown-gated speech with immediate and queued modes.

function createBrowserSpeechAdapter() {
  const isAvailable = () => typeof window !== 'undefined' && !!window.speechSynthesis;

  function buildUtterance(text, onEnd) {
    const utt = new SpeechSynthesisUtterance(text);
    utt.rate = 0.88;
    utt.pitch = 1.0;
    utt.volume = 1.0;
    if (onEnd) {
      utt.onend = onEnd;
      utt.onerror = onEnd;
    }
    return utt;
  }

  return {
    isAvailable,
    isSpeaking() {
      return isAvailable() ? window.speechSynthesis.speaking : false;
    },
    speak(text, { onEnd } = {}) {
      if (!isAvailable()) {
        onEnd?.();
        return false;
      }
      window.speechSynthesis.speak(buildUtterance(text, onEnd));
      return true;
    },
    cancel() {
      if (!isAvailable()) return;
      window.speechSynthesis.cancel();
    },
  };
}

let createVoiceAdapter = () => createBrowserSpeechAdapter();

export function configureVoiceManager({ adapterFactory } = {}) {
  createVoiceAdapter = typeof adapterFactory === 'function'
    ? adapterFactory
    : () => createBrowserSpeechAdapter();
}

export class VoiceManager {
  constructor() {
    this._cooldowns = {};
    this._queue = [];
    this._isQueuedSpeaking = false;
    this._adapter = createVoiceAdapter();
  }

  _playNextQueued() {
    if (!this._adapter?.isAvailable?.()) return;
    if (this._isQueuedSpeaking) return;
    const next = this._queue.shift();
    if (!next) return;
    this._isQueuedSpeaking = true;
    const started = this._adapter.speak(next, {
      onEnd: () => {
        this._isQueuedSpeaking = false;
        this._playNextQueued();
      },
    });
    if (!started) this._isQueuedSpeaking = false;
  }

  speak(text, { key, cooldownMs = 5000, immediate = false } = {}) {
    if (!this._adapter?.isAvailable?.() || !text) return false;
    const k = key !== undefined ? key : text;
    const now = Date.now();
    const last = this._cooldowns[k] || 0;
    if (cooldownMs > 0 && now - last < cooldownMs) return false;
    if (!immediate && this._adapter.isSpeaking()) return false;
    this._cooldowns[k] = now;
    if (immediate) {
      this._queue = [];
      this._isQueuedSpeaking = false;
      this._adapter.cancel();
    }
    return this._adapter.speak(text);
  }

  speakQueued(text, { key, cooldownMs = 0 } = {}) {
    if (!this._adapter?.isAvailable?.() || !text) return false;
    const k = key !== undefined ? key : text;
    const now = Date.now();
    const last = this._cooldowns[k] || 0;
    if (cooldownMs > 0 && now - last < cooldownMs) return false;
    this._cooldowns[k] = now;
    this._queue.push(text);
    this._playNextQueued();
    return true;
  }

  cancel() {
    if (!this._adapter?.isAvailable?.()) return;
    this._queue = [];
    this._isQueuedSpeaking = false;
    this._adapter.cancel();
  }

  resetCooldowns() {
    this._cooldowns = {};
  }

  isBusy() {
    if (!this._adapter?.isAvailable?.()) return false;
    return this._isQueuedSpeaking || this._queue.length > 0 || this._adapter.isSpeaking();
  }
}
