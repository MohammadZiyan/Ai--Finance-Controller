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
