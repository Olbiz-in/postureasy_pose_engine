import fs from 'fs';

function cleanSquat() {
  const path = new URL('../src/exercises/squat/SquatFlow.js', import.meta.url);
  let s = fs.readFileSync(path, 'utf8');

  // Remove orphaned hook block between class closing brace and tick
  s = s.replace(/\}\n\s+\n  \/\/ Phase ref[\s\S]*?this\._advancePhase = \(newPhase\) => \{[\s\S]*?setPhase\(newPhase\);\n  \};\n\n/, '}\n\n  ');

  s = s.replace(/tick\(landmarks, w, h\) \{ \(called every RAF frame from SquatExercise\)[^\n]+\n/, 'tick(landmarks, w, h) {\n');

  s = s.replace(/this\._activeFeedback:/g, 'activeFeedback:');
  s = s.replace(/this\._stancePassedChecks:/g, 'stancePassedChecks:');

  s = s.replace(/\n  \}, \[voice, advancePhase, this\._stancePassedChecks, this\._activeFeedback\]\);\n/, '\n  }\n');

  s = s.replace(/    setPhase\(PHASE\.WAITING_FOR_PERSON\);\n/, '');
  s = s.replace(/    this\._activeFeedback = \(''\);/, "    this._activeFeedback = '';");

  // Ensure class closes before helper functions
  if (!s.includes('}\n\n// ── Small helpers')) {
    s = s.replace(/(\n  reset\(\) \{[\s\S]*?console\.log\('\[Flow\] Reset[\s\S]*?\n  \})\n\n\/\/ ── Small helpers/, '$1\n}\n\n// ── Small helpers');
  }

  fs.writeFileSync(path, s);
}

function cleanPushup() {
  const path = new URL('../src/exercises/pushup/PushUpFlow.js', import.meta.url);
  let s = fs.readFileSync(path, 'utf8');

  s = s.replace(/\}\n    \/\/ REP-BY-REP[\s\S]*?this\._advancePhase = \(newPhase\) => \{[\s\S]*?setPhase\(newPhase\);\n  \};\n\n/, '}\n\n  ');

  s = s.replace(/tick\(landmarks\) \{ \(called every RAF frame from PushUpExercise\)[^\n]+\n/, 'tick(landmarks) {\n');

  s = s.replace(/from '\.\.\/shared\/config\/landmarks'/, "from '../../core/landmarks.js'");

  s = s.replace(/this\._activeFeedback:/g, 'activeFeedback:');

  s = s.replace(/\n  \}, \[voice, advancePhase, this\._activeFeedback\]\);\n/, '\n  }\n');

  s = s.replace(/    setPhase\(PUSHUP_PHASE\.WAITING_FOR_PERSON\);\n/, '');
  s = s.replace(/    this\._activeFeedback = \(''\);/, "    this._activeFeedback = '';");

  if (!s.match(/\n\}\n\n\/\/ ──/)) {
    s = s.replace(/(\n  reset\(\) \{[\s\S]*?console\.log\('\[PushUpFlow\] Reset[\s\S]*?\n  \})\n/, '$1\n}\n');
  }

  fs.writeFileSync(path, s);
}

cleanSquat();
cleanPushup();
console.log('cleaned');
