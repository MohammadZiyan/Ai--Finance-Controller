import type {
  BankTransaction,
  CardNetwork,
  Currency,
  DatasetBundle,
  DisputeStatus,
  GroundTruthRecord,
  LedgerEntry,
  PaymentMethod,
  PaymentRecord,
  RazorpayFeeBreakdown,
  ReconciliationStatus,
  SettlementType,
} from "@/lib/finance/types";
import { isBusinessDay, nextBusinessDay } from "@/lib/finance/scoring";

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
  | "AMBIGUOUS"
  | "MULTI_SPLIT_PAYMENT"
  | "WEEKEND_DATE_DRIFT"
  | "ROUNDING_DISCREPANCY"
  | "SPECIAL_CHAR_VARIATION"
  /* ── Razorpay-specific scenarios ── */
  | "RZP_EXACT_UPI"
  | "RZP_EXACT_CARD"
  | "RZP_NETBANKING"
  | "RZP_WALLET_PAYMENT"
  | "RZP_EMI_PAYMENT"
  | "RZP_REFUND_FULL"
  | "RZP_REFUND_PARTIAL"
  | "RZP_CHARGEBACK"
  | "RZP_FEE_VARIANCE"
  | "RZP_UTR_MISMATCH"
  | "RZP_LATE_AUTH"
  | "RZP_MULTI_SETTLE";

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
  {
    canonical: "Stripe",
    aliases: ["STRIPE PAYMENTS INDIA", "STRIPE INC", "STRIPE GATEWAY", "Stripe India Pvt Ltd", "STRIPE*PAYOUT"],
    category: "Payment Processing",
  },
  {
    canonical: "Razorpay",
    aliases: ["RAZORPAY SOFTWARE", "RAZORPAY GATEWAY BANGALORE", "RAZORPAY CORP", "Razorpay Software Pvt Ltd", "RZP*SETTLEMENT"],
    category: "Payment Processing",
  },
  {
    canonical: "OpenAI",
    aliases: ["OPENAI LLC", "OPENAI CHATGPT API", "OPENAI SAN FRANCISCO", "OpenAI Ireland Ltd", "OPENAI*API.COM"],
    category: "Artificial Intelligence",
  },
  {
    canonical: "Salesforce",
    aliases: ["SALESFORCE.COM", "SFDC INDIA", "SALESFORCE CRM", "Salesforce India Pvt Ltd", "SALESFORCE TOWER"],
    category: "Enterprise SaaS",
  },
  {
    canonical: "Snowflake",
    aliases: ["SNOWFLAKE COMPUTING", "SNOWFLAKE DATA CLOUD", "SNOWFLAKE INC", "Snowflake Software India", "SNOWFLAKE WAREHOUSE"],
    category: "Data Cloud",
  },
];

/** Razorpay-specific bank-statement descriptions per payment method */
const RZP_BANK_DESCRIPTIONS: Record<string, string[]> = {
  UPI: [
    "RZP*SETTLEMENT UPI",
    "RAZORPAY UPI COLLECTION",
    "NEFT*RAZORPAY SETTLEMENT-UPI",
    "IMPS*RZP UPI SETTLE",
    "RAZORPAY SOFTWARE PVT UPI",
  ],
  CARD: [
    "RZP*SETTLEMENT CARD",
    "RAZORPAY CARD COLLECTION",
    "NEFT*RAZORPAY CARD SETTLE",
    "RAZORPAY SOFTWARE PVT CARD",
    "RZP*CARD PAYOUT",
  ],
  NETBANKING: [
    "RZP*SETTLEMENT NETBANKING",
    "RAZORPAY NETBANKING COLLECTION",
    "NEFT*RAZORPAY NB SETTLE",
    "RAZORPAY SOFTWARE PVT NB",
  ],
  WALLET: [
    "RZP*SETTLEMENT WALLET",
    "RAZORPAY WALLET COLLECTION",
    "RAZORPAY SOFTWARE PVT WALLET",
  ],
  EMI: [
    "RZP*SETTLEMENT EMI",
    "RAZORPAY EMI COLLECTION",
    "RAZORPAY SOFTWARE PVT EMI",
  ],
};

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
  "MULTI_SPLIT_PAYMENT",
  "WEEKEND_DATE_DRIFT",
  "ROUNDING_DISCREPANCY",
  "SPECIAL_CHAR_VARIATION",
  /* ── Razorpay-specific scenarios ── */
  "RZP_EXACT_UPI",
  "RZP_EXACT_CARD",
  "RZP_NETBANKING",
  "RZP_WALLET_PAYMENT",
  "RZP_EMI_PAYMENT",
  "RZP_REFUND_FULL",
  "RZP_REFUND_PARTIAL",
  "RZP_CHARGEBACK",
  "RZP_FEE_VARIANCE",
  "RZP_UTR_MISMATCH",
  "RZP_LATE_AUTH",
  "RZP_MULTI_SETTLE",
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

/** Advance by N business days from a base date, returning ISO date string */
function addBusinessDays(base: Date, days: number): string {
  let current = new Date(base);
  for (let i = 0; i < days; i++) {
    current = nextBusinessDay(current);
  }
  return current.toISOString().slice(0, 10);
}

/** Generate a Razorpay-format ID */
function rzpId(prefix: string, index: number, random: () => number): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let id = `${prefix}_`;
  // Use index to seed first 4 chars for determinism, then random for rest
  id += pad(index, 4);
  for (let i = 0; i < 10; i++) {
    id += chars[Math.floor(random() * chars.length)];
  }
  return id;
}

/** Generate a UTR (Unique Transaction Reference) */
function generateUTR(random: () => number): string {
  const bankPrefixes = ["HDFC", "ICIC", "SBIN", "UTIB", "KKBK", "IDFB"];
  const prefix = pick(bankPrefixes, random);
  let utr = prefix;
  for (let i = 0; i < 12; i++) {
    utr += String(Math.floor(random() * 10));
  }
  return utr;
}

/** Calculate Razorpay fee breakdown for a given amount and TDR rate */
function calculateFee(amount: number, tdrRate: number): RazorpayFeeBreakdown {
  const mdr = Math.round(amount * tdrRate * 100) / 100;
  const gst = Math.round(mdr * 0.18 * 100) / 100;
  return {
    mdr,
    gst,
    totalFee: Math.round((mdr + gst) * 100) / 100,
    feeRate: tdrRate,
  };
}

/** Get TDR rate for a payment method */
function getTdrRate(method: PaymentMethod): number {
  switch (method) {
    case "UPI": return 0.02;
    case "NETBANKING": return 0.02;
    case "CARD": return 0.025;
    case "WALLET": return 0.02;
    case "EMI": return 0.03;
    case "PAY_LATER": return 0.03;
    default: return 0.02;
  }
}

function expectedForScenario(
  scenario: ScenarioType,
): { status: ReconciliationStatus; exception: GroundTruthRecord["expected_exception_type"] } {
  switch (scenario) {
    case "EXACT":
    case "DESC_VARIATION":
    case "DATE_DIFFERENCE":
    case "WEEKEND_DATE_DRIFT":
    case "SPECIAL_CHAR_VARIATION":
      return { status: "MATCHED", exception: null };
    case "PARTIAL_PAYMENT":
    case "MULTI_SPLIT_PAYMENT":
      return { status: "AI_MATCHED", exception: "PARTIAL_PAYMENT" };
    case "AMOUNT_MISMATCH":
    case "ROUNDING_DISCREPANCY":
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
    /* ── Razorpay-specific scenario expectations ── */
    case "RZP_EXACT_UPI":
    case "RZP_EXACT_CARD":
    case "RZP_NETBANKING":
    case "RZP_WALLET_PAYMENT":
      return { status: "MATCHED", exception: null };
    case "RZP_EMI_PAYMENT":
      return { status: "MATCHED", exception: null };
    case "RZP_REFUND_FULL":
      return { status: "REVIEW", exception: "REFUND_MISMATCH" };
    case "RZP_REFUND_PARTIAL":
      return { status: "REVIEW", exception: "REFUND_MISMATCH" };
    case "RZP_CHARGEBACK":
      return { status: "UNRESOLVED", exception: "CHARGEBACK" };
    case "RZP_FEE_VARIANCE":
      return { status: "REVIEW", exception: "MDR_VARIANCE" };
    case "RZP_UTR_MISMATCH":
      return { status: "REVIEW", exception: "UTR_MISMATCH" };
    case "RZP_LATE_AUTH":
      return { status: "MATCHED", exception: "LATE_AUTHORIZATION" };
    case "RZP_MULTI_SETTLE":
      return { status: "AI_MATCHED", exception: "PARTIAL_PAYMENT" };
    default:
      return { status: "UNRESOLVED", exception: "UNRESOLVED" };
  }
}

function isRazorpayScenario(scenario: ScenarioType): boolean {
  return scenario.startsWith("RZP_");
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
    const dateOffset =
      scenario === "DATE_DIFFERENCE"
        ? 2
        : scenario === "WEEKEND_DATE_DRIFT"
          ? 3
          : 1;
    const settlement = addDays(startDate, dayOffset + dateOffset);
    const ref = `${vendor.canonical.split(" ").map((s) => s[0]).join("")}-${pad(10000 + i, 5)}`.toUpperCase();
    const currency: Currency = i % 17 === 0 ? "USD" : "INR";

    /* ── Handle Razorpay-specific scenarios ── */
    if (isRazorpayScenario(scenario)) {
      const payId = rzpId("pay", i, random);
      const orderId = rzpId("order", i, random);
      const setlId = rzpId("setl", i, random);
      const utr = generateUTR(random);

      // Determine payment method and fee rate
      let paymentMethod: PaymentMethod = "UPI";
      let cardNetwork: CardNetwork | undefined;
      switch (scenario) {
        case "RZP_EXACT_UPI":
          paymentMethod = "UPI";
          break;
        case "RZP_EXACT_CARD":
          paymentMethod = "CARD";
          cardNetwork = pick(["VISA", "MASTERCARD", "RUPAY"] as CardNetwork[], random);
          break;
        case "RZP_NETBANKING":
          paymentMethod = "NETBANKING";
          break;
        case "RZP_WALLET_PAYMENT":
          paymentMethod = "WALLET";
          break;
        case "RZP_EMI_PAYMENT":
          paymentMethod = "EMI";
          cardNetwork = pick(["VISA", "MASTERCARD"] as CardNetwork[], random);
          break;
        default:
          paymentMethod = pick(["UPI", "CARD", "NETBANKING"] as PaymentMethod[], random);
          break;
      }

      const tdrRate = getTdrRate(paymentMethod);
      const fee = calculateFee(amountBase, tdrRate);
      const netAmount = Math.round((amountBase - fee.totalFee) * 100) / 100;

      // Settlement date: T+2 business days (except specific scenarios)
      const captureDate = new Date(txnDate);
      const settlementDateStr =
        scenario === "RZP_LATE_AUTH"
          ? addBusinessDays(captureDate, 3) // Late auth: T+3
          : scenario === "RZP_WALLET_PAYMENT"
            ? addDays(captureDate, 0) // Wallet: instant/same-day
            : addBusinessDays(captureDate, 2); // Standard: T+2

      // Bank description from Razorpay patterns
      const bankDescOptions = RZP_BANK_DESCRIPTIONS[paymentMethod] ?? RZP_BANK_DESCRIPTIONS["UPI"]!;
      let bankDesc = pick(bankDescOptions, random);

      // Some bank statements include the UTR
      if (random() > 0.5) {
        bankDesc += ` UTR:${utr}`;
      }

      // Determine amounts and special behavior per scenario
      let bankAmount = netAmount;
      let paymentAmount = amountBase;
      let refundAmount: number | undefined;
      let disputeStatus: DisputeStatus = "NONE";
      let settlementType: SettlementType = "PAYMENT";
      let skipLedger = false;
      let skipBank = false;
      let skipPayment = false;
      let feeVariance: RazorpayFeeBreakdown | undefined;

      switch (scenario) {
        case "RZP_REFUND_FULL":
          refundAmount = amountBase;
          bankAmount = 0; // Full refund: no net settlement
          settlementType = "REFUND";
          break;
        case "RZP_REFUND_PARTIAL":
          refundAmount = Math.round(amountBase * 0.3 * 100) / 100;
          bankAmount = Math.round((netAmount - refundAmount) * 100) / 100;
          settlementType = "PAYMENT";
          break;
        case "RZP_CHARGEBACK":
          disputeStatus = "OPEN";
          bankAmount = 0; // Chargeback deducted from settlement
          settlementType = "ADJUSTMENT";
          break;
        case "RZP_FEE_VARIANCE": {
          // MDR differs by small amount from expected
          const variantTdr = tdrRate + 0.003; // 0.3% higher than standard
          feeVariance = calculateFee(amountBase, variantTdr);
          bankAmount = Math.round((amountBase - feeVariance.totalFee) * 100) / 100;
          break;
        }
        case "RZP_UTR_MISMATCH":
          // Bank reports a different UTR than Razorpay
          bankDesc = pick(bankDescOptions, random) + ` UTR:${generateUTR(random)}`; // Different UTR
          break;
        case "RZP_LATE_AUTH":
          // Payment date shifts by 1 day due to late capture
          paymentAmount = amountBase;
          break;
        case "RZP_MULTI_SETTLE":
          // This single bank credit contains multiple payments — handled below
          break;
        default:
          break;
      }

      // Bank record
      if (!skipBank) {
        bank.push({
          bank_transaction_id: `B${pad(bankCounter++)}`,
          transaction_date: settlementDateStr,
          value_date: settlementDateStr,
          description: bankDesc,
          reference: `${setlId} ${payId}`,
          amount: bankAmount,
          currency: "INR",
          transaction_type: "CREDIT",
          account_number_masked: `XXXX${String(1000 + Math.floor(random() * 8000)).slice(-4)}`,
          synthetic_txn_id: txnId,
        });
      }

      // Ledger record
      if (!skipLedger) {
        ledger.push({
          ledger_entry_id: `L${pad(ledgerCounter++)}`,
          transaction_date: txnDate,
          description: `Razorpay ${paymentMethod} Collection - ${orderId}`,
          invoice_number: orderId,
          amount: amountBase,
          currency: "INR",
          accounting_category: "Payment Processing",
          vendor: "Razorpay",
          synthetic_txn_id: txnId,
        });
      }

      // Payment record
      if (!skipPayment) {
        payments.push({
          payment_id: payId,
          payment_date: txnDate,
          merchant: "Razorpay",
          reference: orderId,
          amount: paymentAmount,
          currency: "INR",
          status: scenario === "RZP_CHARGEBACK" ? "DISPUTED" : scenario.includes("REFUND") ? "REFUNDED" : "SETTLED",
          settlement_date: settlementDateStr,
          fee_amount: fee.totalFee,
          synthetic_txn_id: txnId,
          payment_method: paymentMethod,
          card_network: cardNetwork,
          utr,
          settlement_id: setlId,
          order_id: orderId,
          fee_breakdown: feeVariance ?? fee,
          refund_amount: refundAmount,
          dispute_status: disputeStatus,
          settlement_type: settlementType,
        });
      }

      // Multi-settlement: add extra payment records that share the same bank credit
      if (scenario === "RZP_MULTI_SETTLE") {
        const extraCount = 2;
        let totalNet = bankAmount;
        for (let j = 0; j < extraCount; j++) {
          const extraAmount = Math.round((3000 + random() * 20000) * 100) / 100;
          const extraFee = calculateFee(extraAmount, tdrRate);
          const extraNet = Math.round((extraAmount - extraFee.totalFee) * 100) / 100;
          totalNet += extraNet;

          const extraPayId = rzpId("pay", i * 100 + j, random);
          const extraOrderId = rzpId("order", i * 100 + j, random);

          payments.push({
            payment_id: extraPayId,
            payment_date: txnDate,
            merchant: "Razorpay",
            reference: extraOrderId,
            amount: extraAmount,
            currency: "INR",
            status: "SETTLED",
            settlement_date: settlementDateStr,
            fee_amount: extraFee.totalFee,
            synthetic_txn_id: txnId,
            payment_method: paymentMethod,
            utr,
            settlement_id: setlId,
            order_id: extraOrderId,
            fee_breakdown: extraFee,
            settlement_type: "PAYMENT",
          });

          ledger.push({
            ledger_entry_id: `L${pad(ledgerCounter++)}`,
            transaction_date: txnDate,
            description: `Razorpay ${paymentMethod} Collection - ${extraOrderId}`,
            invoice_number: extraOrderId,
            amount: extraAmount,
            currency: "INR",
            accounting_category: "Payment Processing",
            vendor: "Razorpay",
            synthetic_txn_id: txnId,
          });
        }

        // Update bank amount to aggregate total
        const lastBank = bank[bank.length - 1];
        if (lastBank) {
          lastBank.amount = Math.round(totalNet * 100) / 100;
        }
      }

      const expected = expectedForScenario(scenario);
      groundTruth.push({
        transaction_id: txnId,
        expected_status: expected.status,
        expected_exception_type: expected.exception,
        scenario,
      });

      continue; // Skip the generic flow below
    }

    /* ── Generic (non-Razorpay) scenarios ── */
    let bankDesc = vendor.aliases[0]!;
    if (scenario === "DESC_VARIATION") {
      bankDesc = pick(vendor.aliases, random);
    } else if (scenario === "SPECIAL_CHAR_VARIATION") {
      const rawAlias = pick(vendor.aliases, random);
      bankDesc = `POS*${rawAlias.toUpperCase()} // REF#${pad(10000 + i, 5)}`;
    }

    const ledgerVendor = scenario === "DESC_VARIATION" ? pick(vendor.aliases, random) : vendor.canonical;
    const paymentMerchant = scenario === "DESC_VARIATION" ? pick(vendor.aliases, random) : vendor.canonical;

    let amountLedger = amountBase;
    if (scenario === "AMOUNT_MISMATCH") {
      amountLedger = Math.max(100, Math.round((amountBase - 500) * 100) / 100);
    } else if (scenario === "ROUNDING_DISCREPANCY") {
      amountLedger = Math.max(1, Math.round((amountBase - 0.75) * 100) / 100);
    }

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

    if (scenario === "MULTI_SPLIT_PAYMENT") {
      const splitA = Math.round(amountBase * 0.5 * 100) / 100;
      const splitB = Math.round(amountBase * 0.3 * 100) / 100;
      const splitC = Math.round((amountBase - splitA - splitB) * 100) / 100;
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
      payments.push({
        ...paymentRecord,
        payment_id: `P${pad(paymentCounter++)}`,
        amount: splitC,
        settlement_date: addDays(new Date(settlement), 2),
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

