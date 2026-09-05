import { describe, test, expect } from "vitest";
import {
  extractUTR,
  isRazorpayTransaction,
  normalizeMerchantName,
  normalizePaymentMethod,
  normalizeRazorpayId,
} from "@/lib/finance/normalization";
import {
  amountSimilarity,
  businessDayDiff,
  feeSimilarity,
  gstAccuracy,
  isBusinessDay,
  nextBusinessDay,
  settlementDateSimilarity,
  utrSimilarity,
  paymentMethodBoost,
} from "@/lib/finance/scoring";
import { generateSyntheticDataset } from "@/lib/finance/generator";
import { runReconciliation } from "@/lib/finance/reconciliation";
import type { RazorpayFeeBreakdown } from "@/lib/finance/types";

/* ─────────────────────────────────────────────────────────────────────────────
 * 1. UTR Extraction & Matching
 * ───────────────────────────────────────────────────────────────────────────── */

describe("UTR Extraction", () => {
  test("extracts HDFC-style UTR from bank description", () => {
    const utr = extractUTR("RZP*SETTLEMENT UPI UTR:HDFC123456789012");
    expect(utr).toBe("hdfc123456789012");
  });

  test("extracts ICICI-style UTR", () => {
    const utr = extractUTR("NEFT*RAZORPAY SETTLE UTR:ICIC098765432109");
    expect(utr).toBe("icic098765432109");
  });

  test("extracts UTR with hash prefix", () => {
    const utr = extractUTR("RAZORPAY SOFTWARE PVT UTR#SBIN567890123456");
    expect(utr).toBe("sbin567890123456");
  });

  test("returns empty for text without UTR", () => {
    const utr = extractUTR("Regular bank transfer to vendor ABC");
    expect(utr).toBe("");
  });

  test("returns empty for null/empty input", () => {
    expect(extractUTR("")).toBe("");
  });
});

describe("UTR Similarity", () => {
  test("exact UTR match returns 1.0", () => {
    expect(utrSimilarity("HDFC123456789012", "HDFC123456789012")).toBe(1.0);
  });

  test("case-insensitive match returns 1.0", () => {
    expect(utrSimilarity("hdfc123456789012", "HDFC123456789012")).toBe(1.0);
  });

  test("substring match returns 0.9", () => {
    expect(utrSimilarity("HDFC123456789012", "123456789012")).toBe(0.9);
  });

  test("no match returns 0", () => {
    expect(utrSimilarity("HDFC123456789012", "ICIC999999999999")).toBe(0);
  });

  test("empty strings return 0", () => {
    expect(utrSimilarity("", "HDFC123456789012")).toBe(0);
    expect(utrSimilarity("HDFC123456789012", "")).toBe(0);
  });
});

/* ─────────────────────────────────────────────────────────────────────────────
 * 2. Fee Calculation & Similarity
 * ───────────────────────────────────────────────────────────────────────────── */

describe("Fee Similarity", () => {
  test("2% MDR + 18% GST (UPI/netbanking) scores high", () => {
    const gross = 10000;
    const mdr = 200;
    const gst = 36;
    const net = gross - mdr - gst;
    const score = feeSimilarity(gross, net);
    expect(score).toBeGreaterThanOrEqual(0.85);
  });

  test("2.5% MDR + 18% GST (card) scores high", () => {
    const gross = 10000;
    const mdr = 250;
    const gst = 45;
    const net = gross - mdr - gst;
    const score = feeSimilarity(gross, net);
    expect(score).toBeGreaterThanOrEqual(0.85);
  });

  test("3% MDR + 18% GST (EMI) scores high", () => {
    const gross = 10000;
    const mdr = 300;
    const gst = 54;
    const net = gross - mdr - gst;
    const score = feeSimilarity(gross, net);
    expect(score).toBeGreaterThanOrEqual(0.85);
  });

  test("declared fee breakdown with exact match returns 1.0", () => {
    const fee: RazorpayFeeBreakdown = { mdr: 200, gst: 36, totalFee: 236, feeRate: 0.02 };
    const score = feeSimilarity(10000, 10000 - 236, fee);
    expect(score).toBe(1.0);
  });

  test("abnormal fee rate scores low", () => {
    const gross = 10000;
    const net = gross - 800;
    const score = feeSimilarity(gross, net);
    expect(score).toBeLessThan(0.5);
  });

  test("negative net returns 0", () => {
    expect(feeSimilarity(100, 150)).toBe(0);
  });
});

describe("GST Accuracy", () => {
  test("exact 18% of MDR returns 1.0", () => {
    const fee: RazorpayFeeBreakdown = { mdr: 200, gst: 36, totalFee: 236, feeRate: 0.02 };
    expect(gstAccuracy(fee)).toBe(1.0);
  });

  test("slightly off GST returns high score", () => {
    const fee: RazorpayFeeBreakdown = { mdr: 200, gst: 36.20, totalFee: 236.20, feeRate: 0.02 };
    expect(gstAccuracy(fee)).toBeGreaterThanOrEqual(0.9);
  });

  test("severely wrong GST returns low score", () => {
    const fee: RazorpayFeeBreakdown = { mdr: 200, gst: 100, totalFee: 300, feeRate: 0.02 };
    expect(gstAccuracy(fee)).toBeLessThanOrEqual(0.3);
  });

  test("undefined fee returns 0", () => {
    expect(gstAccuracy(undefined)).toBe(0);
  });
});

/* ─────────────────────────────────────────────────────────────────────────────
 * 3. T+2 Business Day Logic
 * ───────────────────────────────────────────────────────────────────────────── */

describe("Business Day Logic", () => {
  test("Monday is a business day", () => {
    expect(isBusinessDay(new Date("2026-08-03"))).toBe(true);
  });

  test("Sunday is not a business day", () => {
    expect(isBusinessDay(new Date("2026-08-02"))).toBe(false);
  });

  test("2nd Saturday is not a business day", () => {
    expect(isBusinessDay(new Date("2026-08-08"))).toBe(false);
  });

  test("1st Saturday is a business day", () => {
    expect(isBusinessDay(new Date("2026-08-01"))).toBe(true);
  });

  test("nextBusinessDay skips Sunday", () => {
    const saturday = new Date("2026-08-01");
    const next = nextBusinessDay(saturday);
    expect(next.getUTCDay()).not.toBe(0);
    expect(next.getUTCDate()).toBeGreaterThan(1);
  });

  test("businessDayDiff counts correctly", () => {
    const diff = businessDayDiff("2026-08-03", "2026-08-05");
    expect(diff).toBe(2);
  });
});

describe("Settlement Date Similarity", () => {
  test("exact T+2 returns 1.0", () => {
    const score = settlementDateSimilarity("2026-08-03", "2026-08-05");
    expect(score).toBe(1.0);
  });

  test("T+3 returns 0.85", () => {
    const score = settlementDateSimilarity("2026-08-03", "2026-08-06");
    expect(score).toBe(0.85);
  });

  test("T+0 returns 0.60", () => {
    const score = settlementDateSimilarity("2026-08-03", "2026-08-03");
    expect(score).toBe(0.60);
  });
});

/* ─────────────────────────────────────────────────────────────────────────────
 * 4. Razorpay Normalization
 * ───────────────────────────────────────────────────────────────────────────── */

describe("Razorpay Merchant Normalization", () => {
  test.each([
    ["RZP*SETTLEMENT UPI", "razorpay"],
    ["RAZORPAY SOFTWARE PVT LTD", "razorpay"],
    ["RAZORPAY GATEWAY BANGALORE", "razorpay"],
    ["RZP*CARD PAYOUT", "razorpay"],
    ["NEFT*RAZORPAY SETTLEMENT-UPI", "razorpay"],
    ["RAZORPAY CORP BENGALURU", "razorpay"],
    ["RAZORPAY UPI COLLECTION", "razorpay"],
    ["IMPS*RZP UPI SETTLE", "razorpay"],
  ])("normalizes '%s' to '%s'", (input, expected) => {
    expect(normalizeMerchantName(input)).toBe(expected);
  });
});

describe("Payment Method Normalization", () => {
  test.each([
    ["UPI", "UPI"],
    ["upi", "UPI"],
    ["CARD", "CARD"],
    ["Visa", "CARD"],
    ["MASTERCARD", "CARD"],
    ["netbanking", "NETBANKING"],
    ["NEFT", "NETBANKING"],
    ["WALLET", "WALLET"],
    ["Paytm", "WALLET"],
    ["EMI", "EMI"],
    ["pay later", "PAY_LATER"],
  ])("normalizes '%s' to '%s'", (input, expected) => {
    expect(normalizePaymentMethod(input)).toBe(expected);
  });
});

describe("Razorpay ID Extraction", () => {
  test("extracts pay_ ID", () => {
    const result = normalizeRazorpayId("Payment pay_ABC123def456gh received");
    expect(result.payId).toBe("pay_abc123def456gh");
  });

  test("extracts order_ ID", () => {
    const result = normalizeRazorpayId("Order order_XYZ789abc012de confirmed");
    expect(result.orderId).toBe("order_xyz789abc012de");
  });

  test("extracts setl_ ID", () => {
    const result = normalizeRazorpayId("Settlement setl_SET456uvw789xy processed");
    expect(result.settlementId).toBe("setl_set456uvw789xy");
  });

  test("extracts multiple IDs from one string", () => {
    const result = normalizeRazorpayId("pay_ABC123def456gh order_XYZ789abc012de");
    expect(result.payId).toBeDefined();
    expect(result.orderId).toBeDefined();
  });

  test("returns empty for non-Razorpay text", () => {
    const result = normalizeRazorpayId("Regular bank transfer");
    expect(result.payId).toBeUndefined();
    expect(result.orderId).toBeUndefined();
    expect(result.settlementId).toBeUndefined();
  });
});

describe("isRazorpayTransaction", () => {
  test("detects razorpay in text", () => {
    expect(isRazorpayTransaction("RAZORPAY SOFTWARE PVT")).toBe(true);
  });

  test("detects rzp in text", () => {
    expect(isRazorpayTransaction("RZP*SETTLEMENT")).toBe(true);
  });

  test("detects pay_ ID", () => {
    expect(isRazorpayTransaction("ref pay_abc123def456gh")).toBe(true);
  });

  test("returns false for non-Razorpay", () => {
    expect(isRazorpayTransaction("AWS INDIA Cloud Services")).toBe(false);
  });
});

/* ─────────────────────────────────────────────────────────────────────────────
 * 5. Payment Method Boost
 * ───────────────────────────────────────────────────────────────────────────── */

describe("Payment Method Boost", () => {
  test("UPI in bank desc + UPI method = 1.0", () => {
    expect(paymentMethodBoost("RZP*SETTLEMENT UPI", "upi")).toBe(1.0);
  });

  test("CARD in bank desc + CARD method = 1.0", () => {
    expect(paymentMethodBoost("RAZORPAY CARD COLLECTION", "card")).toBe(1.0);
  });

  test("mismatched method = 0", () => {
    expect(paymentMethodBoost("RZP*SETTLEMENT UPI", "card")).toBe(0);
  });

  test("no method provided = 0", () => {
    expect(paymentMethodBoost("RZP*SETTLEMENT UPI", undefined)).toBe(0);
  });
});

/* ─────────────────────────────────────────────────────────────────────────────
 * 6. Full Reconciliation Flow with Razorpay Scenarios
 * ───────────────────────────────────────────────────────────────────────────── */

describe("Razorpay Reconciliation Flow", () => {
  test("generates dataset with Razorpay scenarios", () => {
    const dataset = generateSyntheticDataset(62);
    expect(dataset.bank.length).toBeGreaterThan(0);
    expect(dataset.payments.length).toBeGreaterThan(0);
    expect(dataset.groundTruth.length).toBe(62);

    const rzpScenarios = dataset.groundTruth.filter((gt) => gt.scenario.startsWith("RZP_"));
    expect(rzpScenarios.length).toBeGreaterThan(0);
  });

  test("Razorpay payments have pay_ format IDs", () => {
    const dataset = generateSyntheticDataset(62);
    const rzpPayments = dataset.payments.filter((p) => p.payment_method);
    expect(rzpPayments.length).toBeGreaterThan(0);

    for (const p of rzpPayments) {
      expect(p.payment_id).toMatch(/^pay_/);
      expect(p.order_id).toMatch(/^order_/);
      expect(p.settlement_id).toMatch(/^setl_/);
    }
  });

  test("Razorpay payments have fee breakdowns", () => {
    const dataset = generateSyntheticDataset(62);
    const rzpPayments = dataset.payments.filter((p) => p.fee_breakdown);
    expect(rzpPayments.length).toBeGreaterThan(0);

    for (const p of rzpPayments) {
      expect(p.fee_breakdown!.mdr).toBeGreaterThan(0);
      expect(p.fee_breakdown!.gst).toBeGreaterThan(0);
      expect(p.fee_breakdown!.totalFee).toBeGreaterThan(0);
      const expectedGst = p.fee_breakdown!.mdr * 0.18;
      expect(Math.abs(p.fee_breakdown!.gst - expectedGst)).toBeLessThan(0.01);
    }
  });

  test("reconciliation produces Razorpay-specific metrics", async () => {
    const dataset = generateSyntheticDataset(62);
    const result = await runReconciliation(dataset);

    expect(result.metrics.scenarioBreakdown).toBeDefined();
    expect(result.metrics.scenarioBreakdown!.length).toBeGreaterThan(0);
  });

  test("scenario breakdown covers Razorpay scenarios", async () => {
    const dataset = generateSyntheticDataset(62);
    const result = await runReconciliation(dataset);

    const rzpBreakdown = result.metrics.scenarioBreakdown?.filter(
      (s) => s.scenario.startsWith("RZP_"),
    );
    expect(rzpBreakdown).toBeDefined();
    expect(rzpBreakdown!.length).toBeGreaterThan(0);
  });

  test("exception types include Razorpay-specific types", async () => {
    const dataset = generateSyntheticDataset(62);
    const result = await runReconciliation(dataset);

    const exceptionTypes = new Set(result.exceptions.map((e) => e.exception_type));
    expect(exceptionTypes.size).toBeGreaterThan(0);
  });
});
