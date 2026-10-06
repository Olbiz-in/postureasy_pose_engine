// Shared per-rep scoring: every issue key maps to a score group, and each
// group seen in a rep subtracts its weight once (100 = perfect rep).

export function scoreIssues(issueKeys, groupFor, weights, fallbackWeight = 5) {
  const groups = new Set();
  for (const k of issueKeys || []) {
    const g = groupFor(k);
    if (g) groups.add(g);
  }
  let score = 100;
  for (const g of groups) score -= weights[g] ?? fallbackWeight;
  return { score: Math.max(0, Math.round(score)), groups: [...groups] };
}

/** Running mean of rep scores; 100 before the first rep. */
export function createScoreAverager() {
  let sum = 0;
  let n = 0;
  return {
    push(score) {
      sum += score;
      n += 1;
    },
    get value() {
      return n ? Math.round(sum / n) : 100;
    },
    get count() {
      return n;
    },
    reset() {
      sum = 0;
      n = 0;
    },
  };
}

export const clampPct = (v) => Math.max(0, Math.min(100, Math.round(v)));
