import type {
  EvaluationMetrics,
  ExceptionRecord,
  GroundTruthRecord,
  ReconciliationDecision,
  ScenarioMetric,
} from "@/lib/finance/types";

function round(value: number, digits = 2): number {
  return Number(value.toFixed(digits));
}

export function evaluateRun(params: {
  decisions: ReconciliationDecision[];
  exceptions: ExceptionRecord[];
  groundTruth: GroundTruthRecord[];
  sourceRecordsProcessed: number;
  ruleProcessingMs: number;
  aiProcessingMs: number;
  totalProcessingMs: number;
}): EvaluationMetrics {
  const { decisions, exceptions, groundTruth, sourceRecordsProcessed, ruleProcessingMs, aiProcessingMs, totalProcessingMs } =
    params;

  const gtMap = new Map(groundTruth.map((gt) => [gt.transaction_id, gt]));

  const matched = decisions.filter((d) => d.status === "MATCHED").length;
  const aiMatched = decisions.filter((d) => d.status === "AI_MATCHED").length;
  const reviewRequired = decisions.filter((d) => d.status === "REVIEW").length;
  const unresolved = decisions.filter((d) => d.status === "UNRESOLVED").length;

  const predictedMatchedSet = new Set(
    decisions.filter((d) => d.status === "MATCHED" || d.status === "AI_MATCHED").map((d) => d.transactionId),
  );

  const actualMatchedSet = new Set(
    groundTruth
      .filter((gt) => gt.expected_status === "MATCHED" || gt.expected_status === "AI_MATCHED")
      .map((gt) => gt.transaction_id),
  );

  let truePositives = 0;
  let falsePositives = 0;
  for (const id of predictedMatchedSet) {
    if (actualMatchedSet.has(id)) truePositives += 1;
    else falsePositives += 1;
  }

  let falseNegatives = 0;
  for (const id of actualMatchedSet) {
    if (!predictedMatchedSet.has(id)) falseNegatives += 1;
  }

  const precision = predictedMatchedSet.size === 0 ? 0 : truePositives / predictedMatchedSet.size;
  const recall = actualMatchedSet.size === 0 ? 0 : truePositives / actualMatchedSet.size;
  const f1Score = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);

  let exceptionCorrect = 0;
  const expectedExceptions = groundTruth.filter((gt) => gt.expected_exception_type !== null);
  const expectedExceptionMap = new Map(expectedExceptions.map((gt) => [gt.transaction_id, gt.expected_exception_type]));

  for (const ex of exceptions) {
    const expectedType = expectedExceptionMap.get(ex.transaction_id);
    if (expectedType && expectedType === ex.exception_type) exceptionCorrect += 1;
  }

  const highConfidence = decisions.filter((d) => d.confidence >= 0.9).length;
  const totalTransactions = gtMap.size || decisions.length;

  const matchRate = totalTransactions === 0 ? 0 : (truePositives / totalTransactions) * 100;
  const autoResolutionRate = totalTransactions === 0 ? 0 : ((matched + aiMatched) / totalTransactions) * 100;
  const humanReviewRate = totalTransactions === 0 ? 0 : (reviewRequired / totalTransactions) * 100;
  const throughputPerSecond = totalProcessingMs === 0 ? 0 : sourceRecordsProcessed / (totalProcessingMs / 1000);

  /* ── Razorpay-Specific Metrics ── */

  // Per-scenario accuracy breakdown
  const scenarioGroups = new Map<string, { total: number; correct: number }>();
  const decisionMap = new Map(decisions.map((d) => [d.transactionId, d]));

  for (const gt of groundTruth) {
    const group = scenarioGroups.get(gt.scenario) ?? { total: 0, correct: 0 };
    group.total += 1;

    const decision = decisionMap.get(gt.transaction_id);
    if (decision) {
      // A decision is "correct" if its status matches expected, or if matched/ai_matched aligns with expected matched
      const expectedMatched = gt.expected_status === "MATCHED" || gt.expected_status === "AI_MATCHED";
      const actualMatched = decision.status === "MATCHED" || decision.status === "AI_MATCHED";
      if (decision.status === gt.expected_status || (expectedMatched && actualMatched)) {
        group.correct += 1;
      }
    }

    scenarioGroups.set(gt.scenario, group);
  }

  const scenarioBreakdown: ScenarioMetric[] = [...scenarioGroups.entries()].map(([scenario, data]) => ({
    scenario,
    total: data.total,
    correct: data.correct,
    accuracy: round(data.total === 0 ? 0 : (data.correct / data.total) * 100),
  }));

  // Fee reconciliation accuracy (how many Razorpay txns have feeReconciled=true)
  const rzpDecisions = decisions.filter((d) => d.evidence.feeReconciled !== undefined);
  const feeReconciledCount = rzpDecisions.filter((d) => d.evidence.feeReconciled === true).length;
  const feeReconciliationAccuracy = rzpDecisions.length === 0 ? undefined : round((feeReconciledCount / rzpDecisions.length) * 100);

  // UTR match rate
  const utrDecisions = decisions.filter((d) => d.evidence.utrMatch !== undefined);
  const utrMatchCount = utrDecisions.filter((d) => d.evidence.utrMatch === true).length;
  const utrMatchRate = utrDecisions.length === 0 ? undefined : round((utrMatchCount / utrDecisions.length) * 100);

  // Settlement aggregation accuracy (multi-payment batches)
  const batchDecisions = decisions.filter((d) => d.paymentRecordIds.length >= 2);
  const batchCorrect = batchDecisions.filter((d) => d.status === "AI_MATCHED" || d.status === "MATCHED").length;
  const settlementAggregationAccuracy = batchDecisions.length === 0 ? undefined : round((batchCorrect / batchDecisions.length) * 100);

  return {
    totalTransactions,
    sourceRecordsProcessed,
    matched,
    aiMatched,
    reviewRequired,
    unresolved,
    exceptions: exceptions.length,
    highConfidence,
    matchRate: round(matchRate),
    precision: round(precision * 100),
    recall: round(recall * 100),
    f1Score: round(f1Score * 100),
    falsePositives,
    falseNegatives,
    exceptionDetectionAccuracy: round(expectedExceptions.length === 0 ? 0 : (exceptionCorrect / expectedExceptions.length) * 100),
    autoResolutionRate: round(autoResolutionRate),
    humanReviewRate: round(humanReviewRate),
    ruleProcessingMs,
    aiProcessingMs,
    totalProcessingMs,
    throughputPerSecond: round(throughputPerSecond),
    /* ── Razorpay-specific ── */
    scenarioBreakdown,
    feeReconciliationAccuracy,
    utrMatchRate,
    settlementAggregationAccuracy,
  };
}

