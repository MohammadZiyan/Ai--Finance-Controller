import type { LLMAssistResponse } from "@/lib/finance/types";

export interface LLMAssistPayload {
  bankDescription: string;
  ledgerDescription: string;
  paymentDescription: string;
  amountSignals: string;
  dateSignals: string;
  referenceSignals: string;
}

export interface LLMProvider {
  evaluateAmbiguousMatch(payload: LLMAssistPayload): Promise<LLMAssistResponse>;
}

export class DeterministicLLMProvider implements LLMProvider {
  async evaluateAmbiguousMatch(payload: LLMAssistPayload): Promise<LLMAssistResponse> {
    const text = `${payload.bankDescription} ${payload.ledgerDescription} ${payload.paymentDescription}`.toLowerCase();

    const containsCoreVendor =
      (text.includes("amazon") && text.includes("aws")) ||
      (text.includes("google") && text.includes("cloud")) ||
      (text.includes("microsoft") && text.includes("azure"));

    const strongReference = payload.referenceSignals.includes("exact") || payload.referenceSignals.includes("close");
    const amountAligned = payload.amountSignals.includes("exact") || payload.amountSignals.includes("within 1%");

    /* ── Razorpay-specific signal detection ── */
    const isRazorpayTx =
      text.includes("razorpay") ||
      text.includes("rzp") ||
      /pay_[a-z0-9]{12,16}/.test(text) ||
      /setl_[a-z0-9]{12,16}/.test(text) ||
      /order_[a-z0-9]{12,16}/.test(text);

    // UTR cross-reference detection
    const utrMatch = /utr[:\s#-]*([a-z0-9]{12,22})/i;
    const bankUTR = payload.bankDescription.match(utrMatch);
    const paymentUTR = payload.paymentDescription.match(utrMatch);
    const utrAligned = !!(bankUTR && paymentUTR && bankUTR[1] === paymentUTR[1]);

    // Razorpay ID cross-reference
    const payIdPattern = /pay_[a-z0-9]{12,16}/i;
    const bankPayId = payload.bankDescription.match(payIdPattern);
    const ledgerPayId = payload.ledgerDescription.match(payIdPattern);
    const paymentPayId = payload.paymentDescription.match(payIdPattern);
    const payIdAligned = !!(
      (bankPayId && paymentPayId && bankPayId[0].toLowerCase() === paymentPayId[0].toLowerCase()) ||
      (bankPayId && ledgerPayId && bankPayId[0].toLowerCase() === ledgerPayId[0].toLowerCase())
    );

    // Payment method consistency detection
    const paymentMethods = ["upi", "card", "netbanking", "wallet", "emi", "neft", "rtgs", "imps"];
    let methodConsistent = false;
    for (const method of paymentMethods) {
      if (payload.bankDescription.toLowerCase().includes(method) &&
          (payload.paymentDescription.toLowerCase().includes(method) ||
           payload.ledgerDescription.toLowerCase().includes(method))) {
        methodConsistent = true;
        break;
      }
    }

    // Fee/settlement structure signals
    const feeAligned = payload.amountSignals.includes("fee-adjusted") || payload.amountSignals.includes("net-of-fee");

    /* ── Razorpay-specific match decision ── */
    if (isRazorpayTx) {
      const rzpSignals = [
        utrAligned,
        payIdAligned,
        amountAligned,
        methodConsistent,
        strongReference,
        feeAligned,
      ];
      const rzpScore = rzpSignals.filter(Boolean).length;

      if (rzpScore >= 3 || utrAligned || payIdAligned) {
        return {
          match: true,
          confidence: 0.92,
          reason: `Razorpay transaction matched via ${utrAligned ? "UTR" : payIdAligned ? "pay_id" : "multi-signal"} alignment. ` +
            `${rzpScore}/6 Razorpay-specific signals confirmed.`,
          risk_flags: [],
          evidence: [
            `Razorpay detected: true`,
            `UTR aligned: ${utrAligned}`,
            `Payment ID aligned: ${payIdAligned}`,
            `Method consistent: ${methodConsistent}`,
            `Amount signals: ${payload.amountSignals}`,
            `Date signals: ${payload.dateSignals}`,
            `Reference signals: ${payload.referenceSignals}`,
          ],
        };
      }

      if (rzpScore >= 2) {
        return {
          match: true,
          confidence: 0.80,
          reason: `Razorpay transaction with partial signal alignment (${rzpScore}/6). Manual review recommended.`,
          risk_flags: rzpScore < 3 ? ["MDR_VARIANCE"] : [],
          evidence: [
            `Razorpay detected: true`,
            `Signal count: ${rzpScore}/6`,
            `Amount signals: ${payload.amountSignals}`,
            `Date signals: ${payload.dateSignals}`,
          ],
        };
      }

      return {
        match: false,
        confidence: 0.50,
        reason: `Razorpay transaction but insufficient signal alignment (${rzpScore}/6). ` +
          `UTR/payment ID mismatch or fee discrepancy requires investigation.`,
        risk_flags: ["UTR_MISMATCH"],
        evidence: [
          `Razorpay detected: true`,
          `UTR aligned: ${utrAligned}`,
          `Payment ID aligned: ${payIdAligned}`,
          `Amount signals: ${payload.amountSignals}`,
        ],
      };
    }

    /* ── Generic vendor match decision ── */
    const match = (containsCoreVendor && strongReference) || (strongReference && amountAligned);
    const confidence = match ? 0.88 : 0.56;

    return {
      match,
      confidence,
      reason: match
        ? "Descriptions indicate likely merchant alias equivalence and signals are directionally consistent."
        : "Signals are inconclusive across description/reference/amount, so safe auto-resolution is not recommended.",
      risk_flags: match ? [] : ["AMBIGUOUS_MATCH"],
      evidence: [
        `Amount signals: ${payload.amountSignals}`,
        `Date signals: ${payload.dateSignals}`,
        `Reference signals: ${payload.referenceSignals}`,
      ],
    };
  }
}

export function getLLMProvider(): LLMProvider {
  // In a production integration, switch on provider-specific API keys here.
  // This prototype intentionally defaults to deterministic, auditable logic.
  return new DeterministicLLMProvider();
}

