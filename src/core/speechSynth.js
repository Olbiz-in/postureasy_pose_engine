// Small Web Speech API module: speak(text, {priority}), stopCue(), isSpeaking().
//
// Why voice used to go silent in browsers, and what this module does about it:
//  1. Speech is blocked until a user gesture  → unlock() is called inside the
//     Start click handler and speaks a silent utterance.
//  2. getVoices() is empty at startup          → wait for "voiceschanged".
//  3. cancel() immediately followed by speak() drops audio in Chrome
//                                              → wait CANCEL_GAP_MS after cancel.
//  4. Paused synth swallows speech             → resume() before speaking.
//  5. Utterances get garbage-collected mid-speech → keep refs until end/error.
//
// Priorities: 'count' (rep number, never skipped — queued FIFO, interrupts a
// cue) and 'cue' (mistake cue / praise / instruction — at most one pending,
// dropped when a count needs the speaker).

const CANCEL_GAP_MS = 50;
const DEFAULT_CONFIG = { lang: 'en-US', rate: 1.1, volume: 1, pitch: 1 };
const FALLBACK_LANGS = ['en-IN', 'en-US', 'en-GB'];

export function createSpeech({
  getSynth = () => (typeof window !== 'undefined' ? window.speechSynthesis : null),
  getUtteranceCtor = () => (typeof window !== 'undefined' ? window.SpeechSynthesisUtterance : null),
  log = (...a) => console.log('[Speech]', ...a), // eslint-disable-line no-console
  setTimer = (fn, ms) => setTimeout(fn, ms),
} = {}) {
  let config = { ...DEFAULT_CONFIG };
  let voice = null;
  let voicesLoaded = false;
  let listening = false;
  let unlocked = false;
  let warning = '';
  const warnListeners = new Set();

  const live = new Set(); // keeps utterances referenced until end / error
  let current = null; // { text, priority, utt }
  let pendingCue = null; // { text }
  const countQueue = []; // texts waiting for the speaker
  let gapTimer = false; // true while waiting after cancel()

  const synth = () => getSynth();
  const supported = () => !!synth() && !!getUtteranceCtor();

  function setWarning(msg) {
    if (msg === warning) return;
    warning = msg;
    warnListeners.forEach((fn) => fn(msg));
    if (msg) log('WARNING:', msg);
  }

  function pickVoice() {
    const list = synth()?.getVoices?.() || [];
    if (!list.length) return null;
    // Prefer on-device voices: online voices lag badly right after cancel().
    const norm = (v) => (v.lang || '').replace('_', '-');
    const prefs = [config.lang, ...FALLBACK_LANGS.filter((l) => l !== config.lang)];
    for (const lang of prefs) {
      const hits = list.filter((v) => norm(v) === lang);
      const hit = hits.find((v) => v.localService) || hits[0];
      if (hit) return hit;
    }
    return list.find((v) => /^en/i.test(v.lang || '')) || null;
  }

  function loadVoices() {
    const list = synth()?.getVoices?.() || [];
    if (!list.length) return false;
    voice = pickVoice();
    voicesLoaded = true;
    log(`voices loaded: ${list.length}, using`, voice ? `${voice.name} (${voice.lang})` : 'default voice');
    setWarning(voice ? '' : 'No English voice found — using the default voice.');
    return true;
  }

  function init() {
    if (!supported()) {
      setWarning('Voice feedback is not supported in this browser.');
      return false;
    }
    if (!listening) {
      listening = true;
      const s = synth();
      if (s.addEventListener) s.addEventListener('voiceschanged', loadVoices);
      else s.onvoiceschanged = loadVoices;
    }
    if (!voicesLoaded) loadVoices();
    return true;
  }

  function finish(utt) {
    live.delete(utt);
    if (current?.utt === utt) current = null;
    pump();
  }

  function start(text, priority, onEnd, requestedAt = Date.now()) {
    const s = synth();
    const Utt = getUtteranceCtor();
    const utt = new Utt(text);
    utt.lang = config.lang;
    utt.rate = config.rate;
    utt.pitch = config.pitch;
    utt.volume = config.volume;
    if (voice) utt.voice = voice;
    utt.onstart = () => log('start:', text, `(+${Date.now() - requestedAt}ms after request)`);
    utt.onend = () => { log('end:', text); try { onEnd?.(); } catch { /* ignore */ } finish(utt); };
    utt.onerror = (e) => { log('error:', text, e?.error || e); finish(utt); };
    live.add(utt);
    current = { text, priority, utt };
    try {
      if (s.paused) s.resume();
      s.speak(utt);
    } catch (err) {
      log('error:', text, err);
      finish(utt);
    }
  }

  function pump() {
    if (gapTimer || current || !supported()) return;
    if (countQueue.length) {
      const c = countQueue.shift();
      start(c.text, 'count', c.onEnd, c.at);
    } else if (pendingCue) {
      const { text, onEnd, at } = pendingCue;
      pendingCue = null;
      start(text, 'cue', onEnd, at);
    }
  }

  /** cancel() the engine, then wait ~50 ms before speaking again (Chrome drops audio otherwise). */
  function cancelCurrent() {
    const s = synth();
    if (!s) return;
    if (current) {
      const { utt } = current;
      live.delete(utt);
      current = null;
    }
    if (s.speaking || s.pending) {
      s.cancel();
      gapTimer = true;
      setTimer(() => { gapTimer = false; pump(); }, CANCEL_GAP_MS);
    }
  }

  return {
    configure(next = {}) {
      const langChanged = next.lang && next.lang !== config.lang;
      config = { ...config, ...next };
      if (langChanged && voicesLoaded) loadVoices();
    },

    isSupported: supported,

    getWarning: () => warning,

    onWarning(fn) {
      warnListeners.add(fn);
      return () => warnListeners.delete(fn);
    },

    /** Call inside a click handler: starts voice loading and speaks a silent utterance. */
    unlock() {
      if (!init()) return { supported: false, voiceFound: false };
      if (!unlocked) {
        unlocked = true;
        try {
          const Utt = getUtteranceCtor();
          const u = new Utt('Ready');
          u.volume = 0;
          u.lang = config.lang;
          live.add(u);
          u.onend = () => live.delete(u);
          u.onerror = () => live.delete(u);
          const s = synth();
          if (s.paused) s.resume();
          s.speak(u);
          log('unlocked (silent utterance)');
        } catch (err) {
          log('unlock failed', err);
        }
      }
      return { supported: true, voiceFound: voicesLoaded };
    },

    /** @param {{priority?: 'count'|'cue'}} [opts] */
    speak(text, { priority = 'cue', onEnd } = {}) {
      log(`speak(${priority}):`, text);
      if (!text || !init()) return false;
      if (priority === 'count') {
        // A cue is dropped for a count; a count already playing finishes first.
        pendingCue = null;
        countQueue.push({ text, onEnd, at: Date.now() });
        if (current && current.priority === 'cue') cancelCurrent();
        pump();
        return true;
      }
      if (current || gapTimer || countQueue.length) {
        pendingCue = { text, onEnd, at: Date.now() }; // keep only the latest cue
        return true;
      }
      start(text, 'cue', onEnd);
      return true;
    },

    /** Drop any queued cue and stop a cue that is playing. Counts are never touched. */
    stopCue() {
      pendingCue = null;
      if (current && current.priority === 'cue') cancelCurrent();
    },

    /** Stop everything (session end). */
    stopAll() {
      pendingCue = null;
      countQueue.length = 0;
      cancelCurrent();
    },

    isSpeaking: () => !!current || gapTimer || !!synth()?.speaking,
  };
}

/** App-wide instance (browser). */
export const speech = createSpeech();

export function unlockSpeech() {
  return speech.unlock();
}
