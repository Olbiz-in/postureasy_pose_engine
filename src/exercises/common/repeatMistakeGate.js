// A form mistake is only voiced or shown as on-screen text once the same
// mistake shows up in two consecutive reps. Detection, scoring, rep counting
// and summaries are untouched — this only filters what the user is told.
//
// While a rep is under way, a live mistake may be flagged if the previous rep
// had it too. Once the rep closes, only the mistakes it shared with the rep
// before it stay flaggable (until the next rep starts).

export class RepeatMistakeGate {
  constructor() {
    this.reset();
  }

  reset() {
    this._prev = new Set();
    this._allowed = new Set();
    this._open = false;
  }

  /** Call every frame with whether a rep is under way; opens a rep on the rising edge. */
  track(inRep) {
    if (inRep && !this._open) this.startRep();
  }

  startRep() {
    this._open = true;
    this._allowed = new Set(this._prev);
  }

  /**
   * Close a rep with every mistake key it had (in priority order).
   * @returns {string[]} the keys the previous rep also had — the only ones to voice / show.
   */
  endRep(keys) {
    const list = [...new Set((keys || []).filter(Boolean))];
    const repeated = list.filter((k) => this._prev.has(k));
    this._prev = new Set(list);
    this._allowed = new Set(repeated);
    this._open = false;
    return repeated;
  }

  allows(key) {
    return !!key && this._allowed.has(key);
  }

  filter(keys) {
    return (keys || []).filter((k) => this.allows(k));
  }
}
