// TTS voice manager — ported from fitness_posture useVoiceManager.
// Cooldown-gated speech with immediate and queued modes.

export class VoiceManager {
  constructor() {
    this._cooldowns = {};
    this._queue = [];
    this._isQueuedSpeaking = false;
  }

  _buildUtterance(text, onEnd) {
    const utt = new SpeechSynthesisUtterance(text);
    utt.rate = 0.88;
    utt.pitch = 1.0;
    utt.volume = 1.0;
    if (onEnd) utt.onend = onEnd;
    return utt;
  }

  _playNextQueued() {
    if (typeof window === 'undefined' || !window.speechSynthesis) return;
    if (this._isQueuedSpeaking) return;
    const next = this._queue.shift();
    if (!next) return;
    this._isQueuedSpeaking = true;
    const utt = this._buildUtterance(next, () => {
      this._isQueuedSpeaking = false;
      this._playNextQueued();
    });
    window.speechSynthesis.speak(utt);
  }

  speak(text, { key, cooldownMs = 5000, immediate = false } = {}) {
    if (typeof window === 'undefined' || !window.speechSynthesis || !text) return false;
    const k = key !== undefined ? key : text;
    const now = Date.now();
    const last = this._cooldowns[k] || 0;
    if (cooldownMs > 0 && now - last < cooldownMs) return false;
    if (!immediate && window.speechSynthesis.speaking) return false;
    this._cooldowns[k] = now;
    if (immediate) window.speechSynthesis.cancel();
    window.speechSynthesis.speak(this._buildUtterance(text));
    return true;
  }

  speakQueued(text, { key, cooldownMs = 0 } = {}) {
    if (typeof window === 'undefined' || !window.speechSynthesis || !text) return false;
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
    if (typeof window === 'undefined' || !window.speechSynthesis) return;
    this._queue = [];
    this._isQueuedSpeaking = false;
    window.speechSynthesis.cancel();
  }

  resetCooldowns() {
    this._cooldowns = {};
  }

  isBusy() {
    if (typeof window === 'undefined' || !window.speechSynthesis) return false;
    return this._isQueuedSpeaking || this._queue.length > 0 || window.speechSynthesis.speaking;
  }
}
