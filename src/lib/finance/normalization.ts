import type { PaymentMethod } from "@/lib/finance/types";

const LEGAL_SUFFIXES = [
  "pvt ltd",
  "private limited",
  "limited",
  "ltd",
  "inc",
  "llc",
  "corp",
  "co",
  "india",
  "india pvt ltd",
];

const MERCHANT_ALIASES: Record<string, string> = {
  /* ── Cloud Infrastructure ── */
  "aws": "amazon web services",
  "amzn web services": "amazon web services",
  "aws india": "amazon web services",
  "amazon web services india": "amazon web services",
  "ggl cloud": "google cloud",
  "google cloud platform": "google cloud",
  "meta ads": "meta platforms",
  "fb ads": "meta platforms",
  "azure": "microsoft azure",
  "msft azure": "microsoft azure",
  "azure india": "microsoft azure",
  "tata communications ltd": "tata communications",
  "zoho corporation": "zoho",
  /* ── Stripe ── */
  "stripe": "stripe",
  "stripe payments": "stripe",
  "stripe gateway": "stripe",
  "stripe payout": "stripe",
  "stripe payments india": "stripe",
  "stripe inc": "stripe",
  /* ── Razorpay — 25+ real bank-statement variations ── */
  "razorpay": "razorpay",
  "razorpay software": "razorpay",
  "razorpay gateway": "razorpay",
  "rzp settlement": "razorpay",
  "rzp": "razorpay",
  "razorpay software pvt": "razorpay",
  "razorpay corp": "razorpay",
  "razorpay corp bengaluru": "razorpay",
  "razorpay gateway blr": "razorpay",
  "razorpay gateway bangalore": "razorpay",
  "razorpay payout": "razorpay",
  "rzp payout": "razorpay",
  "rzp refund": "razorpay",
  "razorpay refund": "razorpay",
  "rzp settle": "razorpay",
  "razorpay settle": "razorpay",
  "razorpay upi": "razorpay",
  "rzp upi": "razorpay",
  "razorpay netbanking": "razorpay",
  "rzp netbanking": "razorpay",
  "razorpay wallet": "razorpay",
  "razorpay emi": "razorpay",
  "razorpay card": "razorpay",
  "rzp card": "razorpay",
  "razorpay neft": "razorpay",
  "razorpay rtgs": "razorpay",
  "razorpay imps": "razorpay",
  /* ── Enterprise SaaS ── */
  "openai": "openai",
  "openai chatgpt api": "openai",
  "openai api": "openai",
  "openai san francisco": "openai",
  "salesforce": "salesforce",
  "salesforce com": "salesforce",
  "sfdc": "salesforce",
  "salesforce crm": "salesforce",
  "snowflake": "snowflake",
  "snowflake computing": "snowflake",
  "snowflake data cloud": "snowflake",
  "snowflake warehouse": "snowflake",
};

/**
 * Patterns found in Razorpay bank-statement descriptions that use
 * special delimiters (POS*, RZP*, RAZORPAY*, etc.).
 */
const RZP_BANK_STATEMENT_PATTERNS = [
  /rzp\*\s*/gi,
  /razorpay\*\s*/gi,
  /pos\*\s*/gi,
  /neft\*\s*/gi,
  /imps\*\s*/gi,
  /upi\*\s*/gi,
];

export function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function normalizeReference(reference: string | null | undefined): string {
  if (!reference) return "";
  return reference.toLowerCase().replace(/[^a-z0-9]/g, "").trim();
}

export function normalizeMerchantName(input: string): string {
  let normalized = input.toLowerCase().replace(/[^a-z0-9\s]/g, " ");
  normalized = normalizeWhitespace(normalized);

  for (const suffix of LEGAL_SUFFIXES) {
    const regex = new RegExp(`\\b${suffix}\\b`, "g");
    normalized = normalized.replace(regex, " ");
  }

  normalized = normalizeWhitespace(normalized);

  // Strip Razorpay bank-statement prefixes before alias lookup
  for (const pattern of RZP_BANK_STATEMENT_PATTERNS) {
    normalized = normalized.replace(pattern, "");
  }
  normalized = normalizeWhitespace(normalized);

  // Also strip trailing reference fragments like "// REF#12345"
  normalized = normalized.replace(/\s*ref\s*\d+/g, "").trim();

  const alias = MERCHANT_ALIASES[normalized];
  if (alias) return alias;

  const fuzzyAlias = Object.entries(MERCHANT_ALIASES).find(([key]) => normalized.includes(key));
  if (fuzzyAlias) return fuzzyAlias[1];

  return normalized;
}

/**
 * Extract a UTR (Unique Transaction Reference) from a bank description.
 * UTRs are typically 16-22 character alphanumeric strings issued by banks.
 * Common formats: XXXXRYYYYYYYYYYY (4-char bank code + 12-digit sequence)
 * or pure numeric 12-16 digit sequences.
 */
export function extractUTR(text: string): string {
  if (!text) return "";
  // Match common UTR patterns: 12-22 char alphanumeric with possible bank prefix
  const utrPatterns = [
    /\b([A-Z]{4}[A-Z0-9]{12,18})\b/i,         // HDFC/ICICI style: HDFCXXXXXXXX
    /\bUTR[:\s#-]*([A-Z0-9]{12,22})\b/i,       // Prefixed: UTR:XXXXXX or UTR#XXXXXX
    /\b(\d{12,16}[a-z0-9]{0,6})\b/,            // Pure numeric 12-16 digits
    /\b([a-z0-9]{16})\b/i,                     // Generic 16-char alphanumeric
  ];

  for (const pattern of utrPatterns) {
    const match = text.match(pattern);
    if (match?.[1]) return match[1].toLowerCase();
  }
  return "";
}

/**
 * Extract and normalize Razorpay-format IDs (pay_, order_, setl_) from text.
 */
export function normalizeRazorpayId(text: string): { payId?: string; orderId?: string; settlementId?: string } {
  const result: { payId?: string; orderId?: string; settlementId?: string } = {};
  if (!text) return result;

  const payMatch = text.match(/\b(pay_[A-Za-z0-9]{12,16})\b/);
  if (payMatch) result.payId = payMatch[1]!.toLowerCase();

  const orderMatch = text.match(/\b(order_[A-Za-z0-9]{12,16})\b/);
  if (orderMatch) result.orderId = orderMatch[1]!.toLowerCase();

  const setlMatch = text.match(/\b(setl_[A-Za-z0-9]{12,16})\b/);
  if (setlMatch) result.settlementId = setlMatch[1]!.toLowerCase();

  return result;
}

/**
 * Normalize a payment method string to the canonical PaymentMethod type.
 */
export function normalizePaymentMethod(input: string): PaymentMethod | undefined {
  if (!input) return undefined;
  const lower = input.toLowerCase().trim();

  if (lower === "upi" || lower.includes("upi") || lower.includes("bhim") || lower.includes("google pay") || lower.includes("phonepe")) return "UPI";
  if (lower === "card" || lower.includes("card") || lower.includes("visa") || lower.includes("mastercard") || lower.includes("rupay") || lower.includes("amex") || lower.includes("diners")) return "CARD";
  if (lower === "netbanking" || lower.includes("netbanking") || lower.includes("net banking") || lower.includes("neft") || lower.includes("rtgs") || lower.includes("imps")) return "NETBANKING";
  if (lower === "wallet" || lower.includes("wallet") || lower.includes("mobikwik") || lower.includes("paytm") || lower.includes("freecharge")) return "WALLET";
  if (lower === "emi" || lower.includes("emi")) return "EMI";
  if (lower === "pay_later" || lower.includes("pay later") || lower.includes("paylater") || lower.includes("simpl") || lower.includes("lazypay")) return "PAY_LATER";

  return undefined;
}

/**
 * Detect whether a transaction description or merchant string originates
 * from a Razorpay-processed payment.
 */
export function isRazorpayTransaction(text: string): boolean {
  if (!text) return false;
  const lower = text.toLowerCase();
  return (
    lower.includes("razorpay") ||
    lower.includes("rzp") ||
    /\bpay_[a-z0-9]{12,16}\b/.test(lower) ||
    /\bsetl_[a-z0-9]{12,16}\b/.test(lower) ||
    /\border_[a-z0-9]{12,16}\b/.test(lower)
  );
}

export function extractReferenceFromText(text: string): string {
  // Check for Razorpay IDs first
  const rzpIds = normalizeRazorpayId(text);
  if (rzpIds.payId) return normalizeReference(rzpIds.payId);

  const match = text.match(/[A-Z]{2,5}[- ]?\d{3,8}/i);
  return normalizeReference(match?.[0] ?? "");
}

export function tokenize(text: string): string[] {
  return normalizeMerchantName(text)
    .split(" ")
    .map((token) => token.trim())
    .filter(Boolean);
}

