import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { drawFeedback, drawCounters, drawActivityBadge } from '../src/exercises/common/hud.js';

// Minimal 2D context: records filled rects; text width ≈ 0.6 em per char.
function fakeCtx() {
  const rects = [];
  const texts = [];
  let font = '10px';
  const stack = [];
  let tx = 0;
  let sxs = 1;
  return {
    rects,
    texts,
    set font(f) { font = f; },
    get font() { return font; },
    fillStyle: '',
    textAlign: 'left',
    save() { stack.push([tx, sxs]); },
    restore() { [tx, sxs] = stack.pop() || [0, 1]; },
    translate(x) { tx = x; },
    scale(x) { sxs = x; },
    measureText(t) { return { width: String(t).length * 0.6 * parseInt(font.split(' ')[1], 10) }; },
    fillRect(x, y, w, h) { rects.push({ x, y, w, h }); },
    fillText(t) {
      const size = parseInt(font.split(' ')[1], 10);
      texts.push({ t, x: tx, size, width: String(t).length * 0.6 * size });
    },
  };
}

const LONG_MISTAKE = 'Keep your arms in front — don\'t let them drift out to the sides';
const LONG_STATUS = 'Hands to shoulder height, then lower slowly with control';
const RESOLUTIONS = [
  [720, 1280], // portrait phone
  [480, 854], // small portrait
  [1280, 720], // landscape
  [1920, 1080], // full HD
  [3840, 2160], // UHD
  [2160, 3840], // UHD portrait
  [360, 640], // tiny
];

describe('HUD text layout', () => {
  for (const [w, h] of RESOLUTIONS) {
    test(`${w}×${h}: feedback stack stays in frame, in the bottom half, without overlap`, () => {
      const ctx = fakeCtx();
      drawFeedback(ctx, {
        banner: 'Set 1 of 3, Rep 7 of 10 ✓', mistake: LONG_MISTAKE, status: LONG_STATUS, statusKind: 'ok',
      }, w, h, true);
      assert.ok(ctx.rects.length >= 4);
      for (const r of ctx.rects) {
        assert.ok(r.x >= 0 && r.x + r.w <= w + 0.5, `box x ${r.x}..${r.x + r.w} outside 0..${w}`);
        assert.ok(r.y >= h * 0.5 && r.y + r.h <= h, `box y ${r.y}..${r.y + r.h} not in bottom half of ${h}`);
      }
      for (const t of ctx.texts) {
        // centred text: half its width either side of the anchor
        assert.ok(t.x - t.width / 2 >= 0 && t.x + t.width / 2 <= w + 0.5, `text "${t.t}" overflows width ${w}`);
      }
      // Boxes are stacked: sort by y and check no vertical overlap between distinct boxes.
      const outer = ctx.rects.filter((r, i, a) => !a.some((o) => o !== r && o.x <= r.x && o.y <= r.y
        && o.x + o.w >= r.x + r.w && o.y + o.h >= r.y + r.h));
      const sorted = [...outer].sort((a, b) => a.y - b.y);
      for (let i = 1; i < sorted.length; i += 1) {
        assert.ok(sorted[i - 1].y + sorted[i - 1].h <= sorted[i].y + 0.5, 'feedback boxes overlap');
      }
    });

    test(`${w}×${h}: badge and counters fit side by side`, () => {
      const ctx = fakeCtx();
      const fr = { activity: 'not_exercising', currentSet: 1, targetSets: 3, setRepCount: 10, targetReps: 10 };
      drawActivityBadge(ctx, fr, w, h, false);
      drawCounters(ctx, fr, w, h, false);
      const [badge, counters] = ctx.rects;
      assert.ok(badge.x + badge.w <= counters.x, 'badge overlaps counters');
      assert.ok(counters.x + counters.w <= w);
    });
  }
});
