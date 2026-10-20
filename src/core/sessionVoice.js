// Set-start lines shared by every exercise. Spoken through the exercise
// VoiceManager (prime) so stance and rep cues wait behind them instead of
// cutting them off. The app only plays the audio.

const SET_WORDS = ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight'];
const REP_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty'];

function countWord(n, words) {
  const i = Math.max(0, Math.round(Number(n) || 0));
  return words[i] || String(i);
}

export function holdDurationWords(seconds) {
  const s = Math.max(0, Math.round(Number(seconds) || 0));
  const m = Math.floor(s / 60);
  const r = s % 60;
  if (m && r === 30) return m === 1 ? 'one and a half minutes' : `${m} and a half minutes`;
  const minPart = m ? `${m === 1 ? 'one' : m} minute${m === 1 ? '' : 's'}` : '';
  const secPart = r ? `${r} second${r === 1 ? '' : 's'}` : '';
  return [minPart, secPart].filter(Boolean).join(' ') || 'zero seconds';
}

/**
 * Opening line for a set. Empty when there is nothing to announce
 * (freeform session: no rep target and no hold target).
 */
export function setIntroLine({ setNumber = 1, targetReps = 0, targetSeconds = 0 } = {}) {
  const reps = Number(targetReps) > 0 ? Math.round(Number(targetReps)) : 0;
  const seconds = Number(targetSeconds) > 0 ? Math.round(Number(targetSeconds)) : 0;
  if (!reps && !seconds) return '';
  const set = Math.max(1, Math.round(Number(setNumber) || 1));
  const setWord = SET_WORDS[set - 1] || String(set);
  let line = `We are doing set ${setWord}.`;
  if (seconds) line += ` Hold the plank for ${holdDurationWords(seconds)}.`;
  else line += ` Do ${countWord(reps, REP_WORDS)} reps.`;
  return line;
}

function setWord(n) {
  const set = Math.max(1, Math.round(Number(n) || 1));
  return SET_WORDS[set - 1] || String(set);
}

function repWord(n) {
  return countWord(n, REP_WORDS);
}

function formPart(formScore) {
  return typeof formScore === 'number' ? ` Your form accuracy was ${Math.round(formScore)} percent.` : '';
}

export function setCompleteLine(setNumber, repsDone, totalSets, formScore = null) {
  const repsPart = repsDone > 0 ? ` You completed ${repWord(repsDone)} reps.` : ' Set complete.';
  const tail = setNumber >= totalSets ? ' All sets complete. Great work!' : '';
  return `Set ${setWord(setNumber)} done.${repsPart}${formPart(formScore)}${tail}`;
}

export function holdSetCompleteLine(setNumber, heldSeconds, totalSets, formScore = null) {
  const heldPart = heldSeconds >= 1 ? ` You held for ${holdDurationWords(heldSeconds)}.` : ' Set complete.';
  const tail = setNumber >= totalSets ? ' All sets complete. Great work!' : '';
  return `Set ${setWord(setNumber)} done.${heldPart}${formPart(formScore)}${tail}`;
}

export function formAccuracyLine(repsDone, formScore) {
  if (typeof formScore !== 'number' || repsDone <= 0) return '';
  return `You completed ${repWord(repsDone)} reps.${formPart(formScore)}`;
}

export function nextSetHintLine(nextSetNumber) {
  return `When you are ready, press Live Tracking for set ${setWord(nextSetNumber)}.`;
}

export function setIncompleteLine({ hold = false, setNumber, targetReps = 0 } = {}) {
  const set = Math.max(1, Math.round(Number(setNumber) || 1));
  if (hold) return `Set ${set} not complete. Hold for the full time for it to count.`;
  return `Set ${set} not complete. Finish all ${targetReps} reps for it to count.`;
}

export function setNotCountedLine({ hold = false, setNumber, repsDone = 0, targetReps = 0, holdLabel = '' } = {}) {
  const set = Math.max(1, Math.round(Number(setNumber) || 1));
  if (hold) return `Set ${set} not counted — hold for the full ${holdLabel} to finish it.`;
  return `Set ${set} not counted — ${repsDone} of ${targetReps} reps. Finish every rep for the set to count.`;
}

export function sessionStoppedLine(summary) {
  const lead = summary?.stoppedEarly ? 'Session stopped.' : 'All sets complete. Great work!';
  const line = summary?.attempts
    ? String(summary.summaryLine || '').replace('/100', ' out of 100').replace(/%/g, ' percent')
    : 'No reps were recorded.';
  return `${lead} ${line}.`;
}

/**
 * Queue the set intro ahead of coaching. `setIntro: false` keeps exercises
 * that only count reps (lateral / front raise) silent here.
 */
export function primeSetIntro(voice, {
  enabled = true,
  setIntro = true,
  setNumber = 1,
  targetReps = 0,
  targetSeconds = 0,
} = {}) {
  if (!voice || enabled === false || setIntro === false) return false;
  const text = setIntroLine({ setNumber, targetReps, targetSeconds });
  if (!text) return false;
  const key = `set_intro_${Math.max(1, Math.round(Number(setNumber) || 1))}`;
  if (typeof voice.prime === 'function') return voice.prime(text, { key, cooldownMs: 0 });
  return voice.speakQueued(text, { key, cooldownMs: 0 });
}
