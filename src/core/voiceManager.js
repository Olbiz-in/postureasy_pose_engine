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
    this._isDirectSpeaking = false;
    // Set-intro line. Coaching that asks to speak immediately waits behind it
    // instead of cancelling it.
    this._prime = null;
    this._primedUtterance = false;
    // Soft / low-priority line (rep counts). At most one pending; never blocks
    // mistakes. Dropped if still busy when it would play, or replaced by a newer soft.
    this._soft = null;
    // Bumped on every utterance / cancel so a cancelled utterance's late onEnd
    // cannot release the lock held by the utterance that replaced it.
    this._token = 0;
    this._adapter = createVoiceAdapter();
  }

  _ender(flag, wasPrime = false) {
    const token = ++this._token;
    return () => {
      if (token !== this._token) return;
      if (wasPrime) this._primedUtterance = false;
      this[flag] = false;
      this._playNextQueued();
    };
  }

  _takeNext() {
    if (this._prime != null) {
      const text = this._prime;
      this._prime = null;
      this._primedUtterance = true;
      return text;
    }
    this._primedUtterance = false;
    if (this._queue.length) return this._queue.shift();
    // Soft only when the hard queue is empty (mistakes / coaching first).
    if (this._soft) {
      const text = this._soft;
      this._soft = null;
      return text;
    }
    return null;
  }

  _introPending() {
    return this._prime != null || this._primedUtterance;
  }

  _hardBusy() {
    return this._introPending()
      || this._isDirectSpeaking
      || this._isQueuedSpeaking
      || this._queue.length > 0
      || !!this._adapter?.isSpeaking?.();
  }

  _playNextQueued() {
    if (!this._adapter?.isAvailable?.()) return;
    if (this._isQueuedSpeaking || this._isDirectSpeaking) return;
    if (this._adapter.isSpeaking()) return;
    const next = this._takeNext();
    if (!next) return;
    const wasPrime = this._primedUtterance;
    this._isQueuedSpeaking = true;
    const started = this._adapter.speak(next, { onEnd: this._ender('_isQueuedSpeaking', wasPrime) });
    if (!started) {
      this._isQueuedSpeaking = false;
      this._primedUtterance = false;
      this._playNextQueued();
    }
  }

  speak(text, { key, cooldownMs = 5000, immediate = false } = {}) {
    if (!this._adapter?.isAvailable?.() || !text) return false;
    const k = key !== undefined ? key : text;
    const now = Date.now();
    const last = this._cooldowns[k] || 0;
    if (cooldownMs > 0 && now - last < cooldownMs) return false;
    this._cooldowns[k] = now;

    if (immediate) {
      this._queue = [];
      // Mistakes win: drop any pending soft rep-count.
      this._soft = null;
      if (this._introPending()) {
        this._queue.push(text);
        this._playNextQueued();
        return true;
      }
      this._isQueuedSpeaking = false;
      this._isDirectSpeaking = false;
      this._token++;
      this._adapter.cancel();
      this._isDirectSpeaking = true;
      const started = this._adapter.speak(text, { onEnd: this._ender('_isDirectSpeaking') });
      if (!started) this._isDirectSpeaking = false;
      return started;
    }

    // Serialize behind any in-flight or queued speech, including the set intro.
    if (this._hardBusy()) {
      this._queue.push(text);
      this._playNextQueued();
      return true;
    }

    this._isDirectSpeaking = true;
    const started = this._adapter.speak(text, { onEnd: this._ender('_isDirectSpeaking') });
    if (!started) this._isDirectSpeaking = false;
    return started;
  }

  /**
   * Low-priority speak (rep counts). Speaks now only if the channel is free;
   * otherwise keeps at most the latest soft line and plays it when free —
   * never ahead of mistakes. A newer soft call replaces the pending one.
   */
  speakSoft(text, { key } = {}) {
    if (!this._adapter?.isAvailable?.() || !text) return false;
    if (key !== undefined) this._cooldowns[key] = Date.now();
    this._soft = text;
    if (this._hardBusy()) return true;
    this._playNextQueued();
    return true;
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

  /** Speak before every other line. An immediate cue waits until this finishes. */
  prime(text, { key, cooldownMs = 0 } = {}) {
    if (!this._adapter?.isAvailable?.() || !text) return false;
    const k = key !== undefined ? key : text;
    const now = Date.now();
    const last = this._cooldowns[k] || 0;
    if (cooldownMs > 0 && now - last < cooldownMs) return false;
    this._cooldowns[k] = now;
    this._prime = text;
    this._playNextQueued();
    return true;
  }

  cancel() {
    if (!this._adapter?.isAvailable?.()) return;
    this._queue = [];
    this._soft = null;
    this._prime = null;
    this._primedUtterance = false;
    this._isQueuedSpeaking = false;
    this._isDirectSpeaking = false;
    this._token++;
    this._adapter.cancel();
  }

  resetCooldowns() {
    this._cooldowns = {};
  }

  isBusy() {
    if (!this._adapter?.isAvailable?.()) return false;
    return this._introPending() || this._isDirectSpeaking || this._isQueuedSpeaking || this._queue.length > 0 || this._adapter.isSpeaking();
  }
}
