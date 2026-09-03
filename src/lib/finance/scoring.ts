import type { ScoreWeights } from "@/lib/finance/types";
import { tokenize } from "@/lib/finance/normalization";

export const DEFAULT_WEIGHTS: ScoreWeights = {
  description: 0.4,
  amount: 0.3,
  date: 0.15,
  reference: 0.1,
  consistency: 0.05,
};

export function clamp(value: number, min = 0, max = 1): number {
  return Math.min(max, Math.max(min, value));
}

export function amountSimilarity(a: number, b: number): number {
  const max = Math.max(Math.abs(a), Math.abs(b), 1);
  const diff = Math.abs(a - b);
  return clamp(1 - diff / max);
}

export function dateDiffDays(a: string, b: string): number {
  const d1 = new Date(a);
  const d2 = new Date(b);
  const msPerDay = 1000 * 60 * 60 * 24;
  return Math.round(Math.abs(d1.getTime() - d2.getTime()) / msPerDay);
}

export function dateSimilarity(a: string, b: string, toleranceDays: number): number {
  const diff = dateDiffDays(a, b);
  if (diff === 0) return 1;
  if (diff > toleranceDays * 2) return 0;
  return clamp(1 - diff / (toleranceDays * 2));
}

export function tokenJaccardSimilarity(a: string, b: string): number {
  const setA = new Set(tokenize(a));
  const setB = new Set(tokenize(b));

  if (setA.size === 0 || setB.size === 0) return 0;

  let intersection = 0;
  for (const token of setA) {
    if (setB.has(token)) intersection += 1;
  }

  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

export function referenceSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.includes(b) || b.includes(a)) return 0.8;

  const minLen = Math.min(a.length, b.length);
  let same = 0;
  for (let i = 0; i < minLen; i += 1) {
    if (a[i] === b[i]) same += 1;
  }

  return clamp(same / Math.max(a.length, b.length));
}

export function combineScores(
  scores: {
    description: number;
    amount: number;
    date: number;
    reference: number;
    consistency: number;
  },
  weights: ScoreWeights,
): number {
  return clamp(
    scores.description * weights.description +
      scores.amount * weights.amount +
      scores.date * weights.date +
      scores.reference * weights.reference +
      scores.consistency * weights.consistency,
  );
}
