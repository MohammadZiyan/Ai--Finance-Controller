import type {
  BankTransaction,
  Currency,
  DatasetBundle,
  GroundTruthRecord,
  LedgerEntry,
  PaymentRecord,
  ReconciliationStatus,
} from "@/lib/finance/types";

type ScenarioType =
  | "EXACT"
  | "DESC_VARIATION"
  | "AMOUNT_MISMATCH"
  | "DATE_DIFFERENCE"
  | "MISSING_LEDGER"
  | "MISSING_BANK"
  | "MISSING_PAYMENT"
  | "DUPLICATE"
  | "PARTIAL_PAYMENT"
  | "UNEXPECTED_FEE"
  | "CURRENCY_MISMATCH"
  | "AMBIGUOUS";

const VENDORS = [
  {
    canonical: "Amazon Web Services",
    aliases: ["AMZN WEB SERVICES INDIA", "AWS INDIA", "Amazon Web Services India Pvt Ltd"],
    category: "Cloud Infrastructure",
  },
  {
    canonical: "Google Cloud",
    aliases: ["GOOGLE CLOUD PLATFORM", "GGL CLOUD", "Google Cloud India"],
    category: "Cloud Infrastructure",
  },
  {
    canonical: "Microsoft Azure",
    aliases: ["MSFT AZURE", "AZURE INDIA", "Microsoft Azure"],
    category: "Cloud Infrastructure",
  },
  {
    canonical: "Meta Platforms",
    aliases: ["META ADS", "FB ADS", "Meta Platforms"],
    category: "Digital Marketing",
  },
  {
    canonical: "Tata Communications",
    aliases: ["TATA COMMUNICATIONS LTD", "Tata Comm", "Tata Communications"],
    category: "Telecom",
  },
  {
    canonical: "Zoho",
    aliases: ["ZOHO CORPORATION", "Zoho Subscriptions", "Zoho"],
    category: "SaaS",
  },
];

const SCENARIOS: ScenarioType[] = [
  "EXACT",
  "EXACT",
  "EXACT",
  "DESC_VARIATION",
  "DESC_VARIATION",
  "AMOUNT_MISMATCH",
  "DATE_DIFFERENCE",
  "MISSING_LEDGER",
  "MISSING_BANK",
  "MISSING_PAYMENT",
  "DUPLICATE",
  "PARTIAL_PAYMENT",
  "UNEXPECTED_FEE",
  "CURRENCY_MISMATCH",
  "AMBIGUOUS",
];

function mulberry32(seed: number): () => number {
  return () => {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(arr: T[], random: () => number): T {
  return arr[Math.floor(random() * arr.length)]!;
}

function pad(num: number, size = 3): string {
  return String(num).padStart(size, "0");
}

function addDays(base: Date, days: number): string {
  const date = new Date(base);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function expectedForScenario(
  scenario: ScenarioType,
): { status: ReconciliationStatus; exception: GroundTruthRecord["expected_exception_type"] } {
  switch (scenario) {
    case "EXACT":
    case "DESC_VARIATION":
    case "DATE_DIFFERENCE":
      return { status: "MATCHED", exception: null };
    case "PARTIAL_PAYMENT":
      return { status: "AI_MATCHED", exception: "PARTIAL_PAYMENT" };
    case "AMOUNT_MISMATCH":
      return { status: "UNRESOLVED", exception: "AMOUNT_MISMATCH" };
    case "MISSING_LEDGER":
      return { status: "UNRESOLVED", exception: "MISSING_LEDGER_RECORD" };
    case "MISSING_BANK":
      return { status: "UNRESOLVED", exception: "MISSING_BANK_RECORD" };
    case "MISSING_PAYMENT":
      return { status: "REVIEW", exception: "MISSING_PAYMENT_RECORD" };
    case "DUPLICATE":
      return { status: "REVIEW", exception: "DUPLICATE" };
    case "UNEXPECTED_FEE":
      return { status: "REVIEW", exception: "UNEXPECTED_FEE" };
    case "CURRENCY_MISMATCH":
      return { status: "UNRESOLVED", exception: "CURRENCY_MISMATCH" };
    case "AMBIGUOUS":
      return { status: "REVIEW", exception: "AMBIGUOUS_MATCH" };
    default:
      return { status: "UNRESOLVED", exception: "UNRESOLVED" };
  }
}

export function generateSyntheticDataset(transactionCount = 150, seed = 20260903): DatasetBundle {
  const random = mulberry32(seed);
  const startDate = new Date("2026-08-01T00:00:00.000Z");

  const bank: BankTransaction[] = [];
  const ledger: LedgerEntry[] = [];
  const payments: PaymentRecord[] = [];
  const groundTruth: GroundTruthRecord[] = [];

  let bankCounter = 1;
  let ledgerCounter = 1;
  let paymentCounter = 1;

  for (let i = 1; i <= transactionCount; i += 1) {
    const txnId = `TXN-${pad(i, 4)}`;
    const scenario = SCENARIOS[(i - 1) % SCENARIOS.length]!;
    const vendor = pick(VENDORS, random);
    const amountBase = Math.round((5000 + random() * 95000) * 100) / 100;
    const dayOffset = Math.floor(random() * 28);
    const txnDate = addDays(startDate, dayOffset);
    const settlement = addDays(startDate, dayOffset + (scenario === "DATE_DIFFERENCE" ? 2 : 1));
    const ref = `${vendor.canonical.split(" ").map((s) => s[0]).join("")}-${pad(10000 + i, 5)}`.toUpperCase();
    const currency: Currency = i % 17 === 0 ? "USD" : "INR";

    const bankDesc = scenario === "DESC_VARIATION" ? pick(vendor.aliases, random) : vendor.aliases[0]!;
    const ledgerVendor = scenario === "DESC_VARIATION" ? pick(vendor.aliases, random) : vendor.canonical;
    const paymentMerchant = scenario === "DESC_VARIATION" ? pick(vendor.aliases, random) : vendor.canonical;

    const amountLedger =
      scenario === "AMOUNT_MISMATCH" ? Math.max(100, Math.round((amountBase - 500) * 100) / 100) : amountBase;

    const currencyLedger = scenario === "CURRENCY_MISMATCH" ? "EUR" : currency;
    const currencyPayment = scenario === "CURRENCY_MISMATCH" ? "USD" : currency;

    const bankRecord: BankTransaction = {
      bank_transaction_id: `B${pad(bankCounter++)}`,
      transaction_date: txnDate,
      value_date: txnDate,
      description: bankDesc,
      reference: ref,
      amount: scenario === "UNEXPECTED_FEE" ? Math.round((amountBase + 180) * 100) / 100 : amountBase,
      currency,
      transaction_type: "DEBIT",
      account_number_masked: `XXXX${String(1000 + Math.floor(random() * 8000)).slice(-4)}`,
      synthetic_txn_id: txnId,
    };

    const ledgerRecord: LedgerEntry = {
      ledger_entry_id: `L${pad(ledgerCounter++)}`,
      transaction_date: txnDate,
      description: ledgerVendor,
      invoice_number: `INV-${pad(10000 + i, 5)}`,
      amount: amountLedger,
      currency: currencyLedger,
      accounting_category: vendor.category,
      vendor: ledgerVendor,
      synthetic_txn_id: txnId,
    };

    const paymentRecord: PaymentRecord = {
      payment_id: `P${pad(paymentCounter++)}`,
      payment_date: settlement,
      merchant: paymentMerchant,
      reference: ref,
      amount: amountBase,
      currency: currencyPayment,
      status: "SETTLED",
      settlement_date: settlement,
      fee_amount: scenario === "UNEXPECTED_FEE" ? 180 : 0,
      synthetic_txn_id: txnId,
    };

    const expected = expectedForScenario(scenario);

    if (scenario !== "MISSING_BANK") bank.push(bankRecord);
    if (scenario !== "MISSING_LEDGER") ledger.push(ledgerRecord);
    if (scenario !== "MISSING_PAYMENT") payments.push(paymentRecord);

    if (scenario === "DUPLICATE") {
      bank.push({
        ...bankRecord,
        bank_transaction_id: `B${pad(bankCounter++)}`,
      });
    }

    if (scenario === "PARTIAL_PAYMENT") {
      const splitA = Math.round(amountBase * 0.6 * 100) / 100;
      const splitB = Math.round((amountBase - splitA) * 100) / 100;
      payments.push({
        ...paymentRecord,
        payment_id: `P${pad(paymentCounter++)}`,
        amount: splitA,
        settlement_date: settlement,
      });
      payments.push({
        ...paymentRecord,
        payment_id: `P${pad(paymentCounter++)}`,
        amount: splitB,
        settlement_date: addDays(new Date(settlement), 1),
      });
    }

    if (scenario === "AMBIGUOUS") {
      // Add a near-duplicate ledger candidate with similar attributes.
      ledger.push({
        ...ledgerRecord,
        ledger_entry_id: `L${pad(ledgerCounter++)}`,
        invoice_number: `${ledgerRecord.invoice_number}-A`,
        amount: Math.round((ledgerRecord.amount + 25) * 100) / 100,
      });
    }

    groundTruth.push({
      transaction_id: txnId,
      expected_status: expected.status,
      expected_exception_type: expected.exception,
      scenario,
    });
  }

  return { bank, ledger, payments, groundTruth };
}
