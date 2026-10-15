// A form mistake is only voiced or shown as on-screen text once the same
// mistake shows up in two consecutive reps. Detection, scoring, rep counting
// and summaries are untouched — this only filters what the user is told.
//
// At most ONE mistake is shown per rep: the first one let through (live
// during the rep, or at rep end) locks the rep, and only that same mistake
// can be shown again until the next rep starts.
//
// While a rep is under way, a live mistake may be flagged if the previous rep
// had it too. Once the rep closes, only the one mistake picked for it stays
// flaggable (until the next rep starts).

const firstKey = (keys) => keys[0] ?? null;

export class RepeatMistakeGate {
  /**
   * @param {{ pick?: (keys: string[]) => (string|null) }} [opts]
   *   `pick` chooses the one mistake to show when several qualify (e.g. by the
   *   exercise's priority order); defaults to the first in caller order.
   */
  constructor({ pick } = {}) {
    this._pick = pick || firstKey;
    this.reset();
  }

  reset() {
    this._prev = new Set();
    this._allowed = new Set();
    this._shown = null;
    this._open = false;
  }

  /** Call every frame with whether a rep is under way; opens a rep on the rising edge. */
  track(inRep) {
    if (inRep && !this._open) this.startRep();
  }

  startRep() {
    this._open = true;
    this._allowed = new Set(this._prev);
    this._shown = null;
  }

  _choose(keys) {
    if (!keys.length) return null;
    const k = this._pick(keys);
    return keys.includes(k) ? k : keys[0];
  }

  /**
   * Close a rep with every mistake key it had.
   * @returns {string[]} the one mistake to voice / show for this rep (it was
   *   also in the previous rep), or [] — never more than one key.
   */
  endRep(keys) {
    const list = [...new Set((keys || []).filter(Boolean))];
    const repeated = list.filter((k) => this._prev.has(k));
    this._prev = new Set(list);
    this._open = false;
    let shown;
    if (this._shown) shown = repeated.includes(this._shown) ? this._shown : null;
    else shown = this._choose(repeated);
    if (shown) this._shown = shown;
    this._allowed = new Set(shown ? [shown] : []);
    return shown ? [shown] : [];
  }

  /** Whether `key` may be shown now (does not lock the rep — see `claim`). */
  allows(key) {
    return !!key && this._allowed.has(key) && (!this._shown || this._shown === key);
  }

  /** `allows` + locks the rep to `key` when it is shown. */
  claim(key) {
    if (!this.allows(key)) return false;
    this._shown = key;
    return true;
  }

  /**
   * Of the given live mistakes, the ones to show — at most one key; the first
   * one shown locks the rep.
   */
  filter(keys) {
    const ok = [...new Set((keys || []).filter(Boolean))].filter((k) => this.allows(k));
    const key = this._shown && ok.includes(this._shown) ? this._shown : this._choose(ok);
    if (!key) return [];
    this._shown = key;
    return [key];
  }
}
