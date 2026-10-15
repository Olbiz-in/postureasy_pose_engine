import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { RepeatMistakeGate } from '../src/exercises/common/repeatMistakeGate.js';

const PRIORITY = ['a', 'b', 'c'];
const byPriority = (keys) => PRIORITY.find((k) => keys.includes(k)) ?? keys[0];

describe('RepeatMistakeGate', () => {
  test('a mistake is only shown when the previous rep had it too', () => {
    const g = new RepeatMistakeGate();
    g.startRep();
    assert.deepEqual(g.filter(['a']), []);
    assert.deepEqual(g.endRep(['a']), []);
    g.startRep();
    assert.deepEqual(g.filter(['a']), ['a']);
    assert.deepEqual(g.endRep(['a']), ['a']);
  });

  test('at most one mistake per rep, chosen by priority', () => {
    const g = new RepeatMistakeGate({ pick: byPriority });
    g.startRep();
    g.endRep(['c', 'b', 'a']);
    g.startRep();
    assert.deepEqual(g.endRep(['c', 'b', 'a']), ['a']);
  });

  test('the first live mistake shown locks the rep', () => {
    const g = new RepeatMistakeGate({ pick: byPriority });
    g.startRep();
    g.endRep(['a', 'b']);
    g.startRep();
    assert.deepEqual(g.filter(['b']), ['b']);
    // A higher-priority repeated mistake appearing later in the same rep stays hidden.
    assert.deepEqual(g.filter(['a', 'b']), ['b']);
    assert.deepEqual(g.filter(['a']), []);
    assert.equal(g.allows('a'), false);
    assert.equal(g.claim('a'), false);
    // Rep end shows the same mistake, not a second one.
    assert.deepEqual(g.endRep(['a', 'b']), ['b']);
    assert.equal(g.allows('a'), false);
  });

  test('a rep whose shown live mistake is not in its rep-end list shows nothing more', () => {
    const g = new RepeatMistakeGate();
    g.startRep();
    g.endRep(['a', 'b']);
    g.startRep();
    assert.equal(g.claim('a'), true);
    assert.deepEqual(g.endRep(['b']), []);
  });

  test('the lock clears when the next rep starts', () => {
    const g = new RepeatMistakeGate({ pick: byPriority });
    g.startRep();
    g.endRep(['a', 'b']);
    g.startRep();
    g.filter(['b']);
    g.endRep(['a', 'b']);
    g.startRep();
    assert.deepEqual(g.filter(['a', 'b']), ['a']);
  });

  test('consecutive tracking uses every mistake of the previous rep, not just the shown one', () => {
    const g = new RepeatMistakeGate({ pick: byPriority });
    g.startRep();
    g.endRep(['a', 'c']);
    g.startRep();
    assert.deepEqual(g.endRep(['a', 'c']), ['a']);
    g.startRep();
    assert.deepEqual(g.endRep(['c']), ['c']);
  });
});
