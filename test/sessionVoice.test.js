import { test } from 'node:test';
import assert from 'node:assert/strict';

import { configureVoiceManager, VoiceManager } from '../src/core/voiceManager.js';
import { setIntroLine } from '../src/core/sessionVoice.js';

test('set intro names the set, the reps, or the hold', () => {
  assert.equal(setIntroLine({ setNumber: 1, targetReps: 10 }), 'We are doing set one. Do ten reps.');
  assert.equal(setIntroLine({ setNumber: 2, targetReps: 8 }), 'We are doing set two. Do eight reps.');
  assert.equal(
    setIntroLine({ setNumber: 1, targetSeconds: 30 }),
    'We are doing set one. Hold the plank for 30 seconds.',
  );
  assert.equal(setIntroLine({ setNumber: 1 }), '');
});

test('an immediate cue waits until the set intro finishes', () => {
  const spoken = [];
  let release = null;
  let cancelled = 0;
  configureVoiceManager({
    adapterFactory: () => ({
      isAvailable: () => true,
      isSpeaking: () => false,
      speak(text, { onEnd } = {}) {
        spoken.push(text);
        release = onEnd;
        return true;
      },
      cancel() { cancelled += 1; },
    }),
  });

  const voice = new VoiceManager();
  voice.prime('We are doing set one. Do ten reps.', { key: 'set_intro_1', cooldownMs: 0 });
  voice.speak('I am going to check your stance.', { key: 'stance_begin', cooldownMs: 0, immediate: true });

  assert.deepEqual(spoken, ['We are doing set one. Do ten reps.']);
  assert.equal(cancelled, 0);

  release();
  assert.deepEqual(spoken, [
    'We are doing set one. Do ten reps.',
    'I am going to check your stance.',
  ]);
});
