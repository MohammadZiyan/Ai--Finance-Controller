import type { RazorpayFeeBreakdown, ScoreWeights } from "@/lib/finance/types";
import { tokenize } from "@/lib/finance/normalization";

export const DEFAULT_WEIGHTS: ScoreWeights = {
  description: 0.4,
  amount: 0.3,
  date: 0.15,
  reference: 0.1,
  consistency: 0.05,
};

/**
 * Razorpay-optimized weights: heavier on reference (UTR/pay_id matching)
 * and lighter on description since bank statements use opaque RZP* prefixes.
 */
export const RAZORPAY_WEIGHTS: ScoreWeights = {
  description: 0.15,
  amount: 0.30,
  date: 0.15,
  reference: 0.30,
  consistency: 0.10,
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

/* ─────────────────────────────────────────────────────────────────────────────
 * Razorpay-Specific Scoring Functions
 * ───────────────────────────────────────────────────────────────────────────── */

/**
 * Score fee alignment between the bank debit and the expected net settlement.
 * Razorpay standard TDR rates: 2% (UPI/netbanking), 2.5% (cards), 3% (EMI/premium).
 * GST on MDR = 18%.
 *
 * Returns 1.0 if the fee structure matches a known TDR band within tolerance.
 */
export function feeSimilarity(
  grossAmount: number,
  netAmount: number,
  declaredFee?: RazorpayFeeBreakdown,
): number {
  if (grossAmount <= 0) return 0;

  const actualFee = grossAmount - netAmount;
  if (actualFee < 0) return 0; // Net cannot exceed gross

  // If a declared fee breakdown exists, compare directly
  if (declaredFee) {
    const expectedNet = grossAmount - declaredFee.totalFee;
    const diff = Math.abs(netAmount - expectedNet);
    if (diff < 0.01) return 1.0;
    if (diff < 1.0) return 0.95;
    return clamp(1 - diff / Math.max(declaredFee.totalFee, 1));
  }

  // Otherwise infer from standard TDR bands
  const effectiveRate = actualFee / grossAmount;
  const standardRates = [0.02, 0.025, 0.03]; // 2%, 2.5%, 3%
  const gstMultiplier = 1.18; // 18% GST on MDR

  for (const rate of standardRates) {
    const expectedFee = grossAmount * rate * gstMultiplier;
    const diff = Math.abs(actualFee - expectedFee);
    if (diff < 0.50) return 1.0;
    if (diff < 2.0) return 0.90;
    if (diff / Math.max(expectedFee, 1) < 0.05) return 0.85;
  }

  // Check if it's at least in a reasonable range (1.5% - 4%)
  if (effectiveRate >= 0.015 && effectiveRate <= 0.04) return 0.6;

  return 0.2;
}

/**
 * Exact or substring match on UTR (Unique Transaction Reference) numbers.
 * UTR matching is the gold standard for settlement reconciliation.
 */
export function utrSimilarity(bankUTR: string, paymentUTR: string): number {
  if (!bankUTR || !paymentUTR) return 0;

  const a = bankUTR.toLowerCase().trim();
  const b = paymentUTR.toLowerCase().trim();

  if (a === b) return 1.0;
  if (a.includes(b) || b.includes(a)) return 0.9;

  // Partial match: compare last 8 digits (bank systems sometimes truncate)
  const tailA = a.slice(-8);
  const tailB = b.slice(-8);
  if (tailA === tailB && tailA.length === 8) return 0.75;

  return 0;
}

/**
 * Boost confidence when payment methods match across data sources.
 */
export function paymentMethodBoost(
  bankDesc: string,
  paymentMethod?: string,
): number {
  if (!paymentMethod) return 0;

  const desc = bankDesc.toLowerCase();
  const method = paymentMethod.toLowerCase();

  const methodKeywords: Record<string, string[]> = {
    upi: ["upi", "bhim", "google pay", "phonepe", "gpay"],
    card: ["card", "visa", "mastercard", "mc", "rupay", "amex", "diners"],
    netbanking: ["netbanking", "net banking", "neft", "rtgs", "imps"],
    wallet: ["wallet", "mobikwik", "paytm", "freecharge"],
    emi: ["emi"],
    pay_later: ["pay later", "paylater", "simpl", "lazypay"],
  };

  const keywords = methodKeywords[method];
  if (!keywords) return 0;

  for (const keyword of keywords) {
    if (desc.includes(keyword)) return 1.0;
  }

  return 0;
}

/**
 * Check if a date falls on a business day (Mon-Fri, excluding 2nd/4th Sat).
 * Razorpay settlements only happen on bank working days.
 */
export function isBusinessDay(date: Date): boolean {
  const day = date.getUTCDay();
  // Sunday = 0
  if (day === 0) return false;
  // Saturday: only 1st and 3rd Saturdays are working days in India
  if (day === 6) {
    const dayOfMonth = date.getUTCDate();
    const weekOfMonth = Math.ceil(dayOfMonth / 7);
    // 2nd Saturday (week 2) and 4th Saturday (week 4) are holidays
    return weekOfMonth !== 2 && weekOfMonth !== 4;
  }
  return true;
}

/**
 * Advance to the next business day from a given date.
 */
export function nextBusinessDay(date: Date): Date {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + 1);
  while (!isBusinessDay(result)) {
    result.setUTCDate(result.getUTCDate() + 1);
  }
  return result;
}

/**
 * Count the number of business days between two dates.
 */
export function businessDayDiff(a: string, b: string): number {
  const d1 = new Date(a);
  const d2 = new Date(b);
  const start = d1 < d2 ? d1 : d2;
  const end = d1 < d2 ? d2 : d1;

  let count = 0;
  const current = new Date(start);
  current.setUTCDate(current.getUTCDate() + 1);

  while (current <= end) {
    if (isBusinessDay(current)) count += 1;
    current.setUTCDate(current.getUTCDate() + 1);
  }

  return count;
}

/**
 * T+2 settlement-aware date similarity.
 * A settlement arriving exactly T+2 business days after capture
 * receives a perfect score. Deviations are penalized smoothly.
 */
export function settlementDateSimilarity(
  captureDate: string,
  settlementDate: string,
  expectedBusinessDays = 2,
): number {
  const bizDays = businessDayDiff(captureDate, settlementDate);
  if (bizDays === expectedBusinessDays) return 1.0;

  const drift = Math.abs(bizDays - expectedBusinessDays);
  if (drift === 1) return 0.85;
  if (drift === 2) return 0.60;
  if (drift <= 4) return 0.35;
  return 0;
}

/**
 * Validate that GST is correctly computed as 18% of MDR.
 * Returns a score indicating GST accuracy.
 */
export function gstAccuracy(fee?: RazorpayFeeBreakdown): number {
  if (!fee || fee.mdr <= 0) return 0;
  const expectedGst = fee.mdr * 0.18;
  const diff = Math.abs(fee.gst - expectedGst);
  if (diff < 0.01) return 1.0;
  if (diff < 0.50) return 0.90;
  if (diff / Math.max(expectedGst, 0.01) < 0.05) return 0.75;
  return 0.3;
}

