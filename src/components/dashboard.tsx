"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type SummaryResponse = {
  ok: boolean;
  data: {
    run: {
      id: number;
      batchName: string;
      createdAt: string;
      sourceType: string;
      metrics: Record<string, unknown>;
    };
    statusCounts: Array<{ status: string; count: number }>;
    exceptionCounts: Array<{ type: string; count: number }>;
  } | null;
};

type TransactionRow = {
  id: number;
  transactionId: string;
  status: string;
  confidence: string;
  reason: string;
  recommendedAction: string;
  evidence: Record<string, unknown>;
  bank: { amount: string; description: string } | null;
  ledger: { amount: string; description: string } | null;
  payments: Array<{ amount: string; merchant: string }>;
};

type ExceptionRow = {
  id: number;
  exceptionType: string;
  severity: string;
  status: string;
  confidence: string;
  reason: string;
  transactionId: string;
  amountDifference?: string | null;
  dateDifferenceDays?: number | null;
  humanDecision?: string | null;
};

export function Dashboard() {
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<"synthetic" | "upload">("synthetic");
  const [transactionCountPreset, setTransactionCountPreset] = useState<number>(150);
  const [runId, setRunId] = useState<number | null>(null);
  const [summary, setSummary] = useState<SummaryResponse["data"]>(null);
  const [transactions, setTransactions] = useState<TransactionRow[]>([]);
  const [exceptions, setExceptions] = useState<ExceptionRow[]>([]);
  const [selectedTransactionId, setSelectedTransactionId] = useState<string | null>(null);
  const [selectedTransaction, setSelectedTransaction] = useState<any>(null);

  // Filters & Search
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [exceptionFilter, setExceptionFilter] = useState({ type: "", severity: "", status: "" });

  // Upload states
  const [upload, setUpload] = useState({ bankCsv: "", ledgerCsv: "", paymentCsv: "" });
  const [fileNames, setFileNames] = useState({ bank: "", ledger: "", payment: "" });
  const [error, setError] = useState<string | null>(null);

  // Theme Sync
  useEffect(() => {
    const saved = localStorage.getItem("rzp_theme") as "light" | "dark" | null;
    const initialTheme = saved || "light";
    setTheme(initialTheme);
    if (initialTheme === "dark") {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
  }, []);

  const toggleTheme = () => {
    const next = theme === "light" ? "dark" : "light";
    setTheme(next);
    localStorage.setItem("rzp_theme", next);
    if (next === "dark") {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
  };

  async function fetchRunData(targetRunId?: number) {
    const runQuery = targetRunId ? `?runId=${targetRunId}` : "";

    const [summaryRes, txRes, exRes] = await Promise.all([
      fetch(`/api/reconciliation/summary${runQuery}`),
      fetch(`/api/transactions${runQuery}`),
      fetch(`/api/exceptions${runQuery}`),
    ]);

    const summaryJson: SummaryResponse = await summaryRes.json();
    const txJson = await txRes.json();
    const exJson = await exRes.json();

    setSummary(summaryJson.data);
    setTransactions(txJson.data ?? []);
    setExceptions(exJson.data ?? []);

    if (summaryJson.data?.run?.id) {
      setRunId(summaryJson.data.run.id);
    }
  }

  async function runDemoDataset(count = transactionCountPreset) {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/reconciliation/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "demo", transactionCount: count }),
      });

      const json = await res.json();
      if (!json.ok) {
        throw new Error(json.error || "Failed to run demo");
      }

      await fetchRunData(json.runId);
      if (transactions.length > 0 && !selectedTransactionId) {
        setSelectedTransactionId(transactions[0].transactionId);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  async function runUploadedDataset() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/reconciliation/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "upload", ...upload, batchName: "Stream Ingestion Batch" }),
      });

      const json = await res.json();
      if (!json.ok) {
        throw new Error(json.error || "Failed to run uploaded dataset");
      }

      await fetchRunData(json.runId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  const fetchTransactionDetail = useCallback(async (transactionId: string) => {
    setSelectedTransactionId(transactionId);
    const query = runId ? `?runId=${runId}` : "";
    const res = await fetch(`/api/transactions/${transactionId}${query}`);
    const json = await res.json();
    setSelectedTransaction(json.data ?? null);
  }, [runId]);

  async function updateException(id: number, action: string) {
    await fetch(`/api/exceptions/${id}/resolve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });

    const filterQuery = new URLSearchParams();
    if (runId) filterQuery.set("runId", String(runId));
    if (exceptionFilter.type) filterQuery.set("type", exceptionFilter.type);
    if (exceptionFilter.severity) filterQuery.set("severity", exceptionFilter.severity);
    if (exceptionFilter.status) filterQuery.set("status", exceptionFilter.status);

    const exRes = await fetch(`/api/exceptions?${filterQuery.toString()}`);
    const exJson = await exRes.json();
    setExceptions(exJson.data ?? []);
  }

  async function handleCsvFile(file: File, key: "bankCsv" | "ledgerCsv" | "paymentCsv", nameKey: "bank" | "ledger" | "payment") {
    const content = await file.text();
    setUpload((prev) => ({ ...prev, [key]: content }));
    setFileNames((prev) => ({ ...prev, [nameKey]: file.name }));
  }

  async function applyExceptionFilter(nextFilter = exceptionFilter) {
    const filterQuery = new URLSearchParams();
    if (runId) filterQuery.set("runId", String(runId));
    if (nextFilter.type) filterQuery.set("type", nextFilter.type);
    if (nextFilter.severity) filterQuery.set("severity", nextFilter.severity);
    if (nextFilter.status) filterQuery.set("status", nextFilter.status);

    const exRes = await fetch(`/api/exceptions?${filterQuery.toString()}`);
    const exJson = await exRes.json();
    setExceptions(exJson.data ?? []);
  }

  useEffect(() => {
    fetchRunData().then(() => {
      // initial load
    }).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!selectedTransactionId) return;
    fetchTransactionDetail(selectedTransactionId).catch(() => undefined);
  }, [fetchTransactionDetail, selectedTransactionId]);

  const metrics = (summary?.run.metrics ?? {}) as Record<string, number>;

  const statusMap = useMemo(() => {
    const map = new Map<string, number>();
    summary?.statusCounts.forEach((s) => map.set(s.status, s.count));
    return map;
  }, [summary]);

  // Filtered transactions for explorer
  const filteredTransactions = useMemo(() => {
    return transactions.filter((t) => {
      const matchesStatus = statusFilter === "ALL" || t.status === statusFilter;
      const q = searchQuery.toLowerCase().trim();
      if (!q) return matchesStatus;

      const matchesId = t.transactionId.toLowerCase().includes(q);
      const matchesReason = (t.reason ?? "").toLowerCase().includes(q);
      const matchesBank = (t.bank?.description ?? "").toLowerCase().includes(q);
      const matchesLedger = (t.ledger?.description ?? "").toLowerCase().includes(q);
      const matchesPayment = t.payments.some((p) => (p.merchant ?? "").toLowerCase().includes(q));

      return matchesStatus && (matchesId || matchesReason || matchesBank || matchesLedger || matchesPayment);
    });
  }, [transactions, statusFilter, searchQuery]);

  return (
    <main className="min-h-screen bg-[#F8FAFC] dark:bg-[#0A0D14] text-slate-900 dark:text-slate-100 pb-16 transition-colors duration-150">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 space-y-6 pt-6">

        {/* Top Header Navigation Bar */}
        <header className="rzp-card p-5 sm:p-6 flex flex-col md:flex-row md:items-center md:justify-between gap-4 border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#101623]">
          <div className="flex items-center gap-3.5">
            {/* Razorpay Brand Icon */}
            <div className="relative flex h-11 w-11 items-center justify-center rounded-xl bg-[#0052FF] text-white shadow-sm">
              <svg className="h-6 w-6" viewBox="0 0 24 24" fill="currentColor">
                <path d="M14.5 3L6.5 14h5.5l-2.5 7L17.5 10H12l2.5-7z" />
              </svg>
            </div>

            <div>
              <div className="flex items-center gap-2.5 flex-wrap">
                <h1 className="text-xl font-bold tracking-tight text-slate-900 dark:text-white flex items-center gap-2">
                  <span>Razorpay</span>
                  <span className="font-normal text-slate-400 dark:text-slate-500">|</span>
                  <span className="text-[#0052FF] font-semibold">Finance Controller</span>
                </h1>
                <span className="rounded-full bg-blue-50 dark:bg-blue-950/70 px-2.5 py-0.5 text-[11px] font-semibold text-[#0052FF] dark:text-blue-400 border border-blue-200 dark:border-blue-800/80">
                  Autonomous Reconciler
                </span>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Multi-source ledger matching, fee variance detection & exception resolution workspace
              </p>
            </div>
          </div>

          <div className="flex items-center flex-wrap gap-2.5">
            {/* Batch Status Pill */}
            <div className="flex items-center gap-2 rounded-lg bg-slate-50 dark:bg-[#161F30] px-3 py-1.5 border border-slate-200 dark:border-slate-800 text-xs text-slate-600 dark:text-slate-300">
              <span className="inline-block h-2 w-2 rounded-full bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.6)]" />
              <span className="text-slate-400 font-medium">Batch:</span>
              <span className="font-semibold text-slate-800 dark:text-slate-200 truncate max-w-[140px]">
                {summary?.run?.batchName ?? "Ready for Run"}
              </span>
              <span className="text-slate-300 dark:text-slate-700">|</span>
              <span className="font-mono text-[11px] text-slate-500 dark:text-slate-400">
                {summary?.run?.createdAt ? new Date(summary.run.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : "Idle"}
              </span>
            </div>

            {/* Theme Toggle Button */}
            <button
              type="button"
              onClick={toggleTheme}
              className="inline-flex items-center justify-center h-9 w-9 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#161F30] text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              title={theme === "light" ? "Switch to Dark Mode (Night Quarters)" : "Switch to Light Mode (Daytime)"}
            >
              {theme === "light" ? (
                <svg className="h-4 w-4 text-slate-700" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
                </svg>
              ) : (
                <svg className="h-4 w-4 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
                </svg>
              )}
            </button>

            {/* Primary Action Button (Razorpay Blue) */}
            <button
              type="button"
              onClick={() => runDemoDataset(150)}
              disabled={loading}
              className="inline-flex items-center gap-2 rounded-lg bg-[#0052FF] hover:bg-[#0043D6] active:bg-[#0036AB] px-4 py-2 text-xs font-semibold text-white shadow-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
            >
              {loading ? (
                <>
                  <svg className="animate-spin h-3.5 w-3.5 text-white" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                  </svg>
                  <span>Reconciling...</span>
                </>
              ) : (
                <>
                  <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M5 3l14 9-14 9V3z" />
                  </svg>
                  <span>Run Demo Dataset</span>
                </>
              )}
            </button>
          </div>
        </header>

        {/* 5 High-Trust KPI Metric Cards Grid */}
        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <KpiCard
            title="Records Processed"
            value={String(metrics.sourceRecordsProcessed ?? 0)}
            subtitle="Bank + Ledger + Gateway"
            iconColor="text-[#0052FF] bg-blue-50 dark:bg-blue-950/50"
            icon={
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 7v10c0 2 1 3 3 3h10c2 0 3-1 3-3V7M4 7c0-2 1-3 3-3h10c2 0 3 1 3 3M4 7h16m-5 4v6m-6-6v6" />
              </svg>
            }
          />
          <KpiCard
            title="Match Rate"
            value={`${metrics.matchRate ?? 0}%`}
            subtitle={`Precision: ${metrics.precision ?? 0}% | F1: ${metrics.f1Score ?? 0}%`}
            iconColor="text-emerald-600 bg-emerald-50 dark:bg-emerald-950/50"
            icon={
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            }
          />
          <KpiCard
            title="Auto Resolved"
            value={String((metrics.matched ?? 0) + (metrics.aiMatched ?? 0))}
            subtitle={`${metrics.matched ?? 0} Direct • ${metrics.aiMatched ?? 0} AI Assisted`}
            iconColor="text-[#0052FF] bg-blue-50 dark:bg-blue-950/50"
            icon={
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            }
          />
          <KpiCard
            title="Exceptions Flagged"
            value={String(metrics.exceptions ?? 0)}
            subtitle={`${metrics.unresolved ?? 0} Unresolved • ${metrics.reviewRequired ?? 0} Review`}
            iconColor="text-amber-600 bg-amber-50 dark:bg-amber-950/50"
            icon={
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            }
          />
          <KpiCard
            title="Reconciliation Speed"
            value={`${metrics.totalProcessingMs ?? 0} ms`}
            subtitle={`${metrics.throughputPerSecond ? Math.round(metrics.throughputPerSecond) : 0} txns / sec`}
            iconColor="text-indigo-600 bg-indigo-50 dark:bg-indigo-950/50"
            icon={
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            }
          />
        </section>

        {/* Dual Mode Run Hub & Reconciliation Spectrum */}
        <section className="grid gap-6 lg:grid-cols-12">
          {/* Controls Panel (7 Cols) */}
          <div className="lg:col-span-7 rzp-card p-6 border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#101623] flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3 mb-4">
                <div className="flex items-center gap-2">
                  <div className="h-2 w-2 rounded-full bg-[#0052FF]" />
                  <h2 className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">
                    Execution & Ingestion Controls
                  </h2>
                </div>

                {/* Tab Switcher */}
                <div className="flex rounded-lg bg-slate-100 dark:bg-[#161F30] p-1 border border-slate-200 dark:border-slate-800">
                  <button
                    type="button"
                    onClick={() => setActiveTab("synthetic")}
                    className={`px-3 py-1 text-xs font-semibold rounded-md transition-all cursor-pointer ${
                      activeTab === "synthetic"
                        ? "bg-[#0052FF] text-white shadow-xs"
                        : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
                    }`}
                  >
                    Synthetic Simulation
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveTab("upload")}
                    className={`px-3 py-1 text-xs font-semibold rounded-md transition-all cursor-pointer ${
                      activeTab === "upload"
                        ? "bg-[#0052FF] text-white shadow-xs"
                        : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
                    }`}
                  >
                    CSV Ingestion
                  </button>
                </div>
              </div>

              {activeTab === "synthetic" ? (
                <div className="space-y-4">
                  <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                    Inject realistic enterprise reconciliation datasets comprising multi-source discrepancies: exact matches, description variations, date drift, currency discrepancies, unexpected fee charges, partial splits, and duplicate settlements.
                  </p>

                  <div className="flex flex-wrap items-center gap-2.5">
                    <span className="text-xs text-slate-500 dark:text-slate-400 font-medium">Batch Scale:</span>
                    {[
                      { label: "60 Txns", count: 60 },
                      { label: "150 Txns (Standard)", count: 150 },
                      { label: "300 Txns (Heavy)", count: 300 },
                    ].map((preset) => (
                      <button
                        key={preset.count}
                        type="button"
                        onClick={() => setTransactionCountPreset(preset.count)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all cursor-pointer ${
                          transactionCountPreset === preset.count
                            ? "border-[#0052FF] bg-blue-50 text-[#0052FF] dark:bg-blue-950/60 dark:text-blue-400 font-semibold"
                            : "border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#161F30] text-slate-600 dark:text-slate-400 hover:border-slate-300 dark:hover:border-slate-700"
                        }`}
                      >
                        {preset.label}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  <p className="text-xs text-slate-600 dark:text-slate-300">
                    Upload Bank, General Ledger, and Payment Processor CSV files for 3-way reconciliation:
                  </p>

                  <div className="grid gap-2.5 sm:grid-cols-3">
                    <UploadSlot
                      label="1. Bank Statement"
                      fileName={fileNames.bank}
                      onChange={(e) => e.target.files?.[0] && handleCsvFile(e.target.files[0], "bankCsv", "bank")}
                    />
                    <UploadSlot
                      label="2. Ledger Entries"
                      fileName={fileNames.ledger}
                      onChange={(e) => e.target.files?.[0] && handleCsvFile(e.target.files[0], "ledgerCsv", "ledger")}
                    />
                    <UploadSlot
                      label="3. Payment Records"
                      fileName={fileNames.payment}
                      onChange={(e) => e.target.files?.[0] && handleCsvFile(e.target.files[0], "paymentCsv", "payment")}
                    />
                  </div>
                </div>
              )}
            </div>

            <div className="mt-5 pt-4 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between flex-wrap gap-3">
              <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                <span className="h-1.5 w-1.5 rounded-full bg-[#0052FF]" />
                <span>Deterministic Rules + Fuzzy Matching + AI Discrepancy Scoring</span>
              </div>

              {activeTab === "synthetic" ? (
                <button
                  type="button"
                  onClick={() => runDemoDataset(transactionCountPreset)}
                  disabled={loading}
                  className="rounded-lg bg-[#0052FF] hover:bg-[#0043D6] active:bg-[#0036AB] px-4 py-2 text-xs font-semibold text-white shadow-sm transition-all disabled:opacity-50 cursor-pointer"
                >
                  {loading ? "Reconciling..." : `Reconcile ${transactionCountPreset} Records`}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={runUploadedDataset}
                  disabled={loading || !upload.bankCsv || !upload.ledgerCsv || !upload.paymentCsv}
                  className="rounded-lg bg-[#0052FF] hover:bg-[#0043D6] active:bg-[#0036AB] px-4 py-2 text-xs font-semibold text-white shadow-sm transition-all disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
                >
                  {loading ? "Processing..." : "Process Uploaded Streams"}
                </button>
              )}
            </div>

            {error && (
              <div className="mt-3 rounded-lg bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800/60 p-2.5 text-xs text-rose-700 dark:text-rose-300">
                {error}
              </div>
            )}
          </div>

          {/* Reconciliation Spectrum & Breakdown (5 Cols) */}
          <div className="lg:col-span-5 rzp-card p-6 border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#101623] flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3 mb-4">
                <div className="flex items-center gap-2">
                  <div className="h-2 w-2 rounded-full bg-emerald-500" />
                  <h2 className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">
                    Reconciliation Status Spectrum
                  </h2>
                </div>
                <span className="text-xs text-slate-500 font-mono-numbers">
                  {transactions.length} total txns
                </span>
              </div>

              {/* Proportional Segmented Bar */}
              <div className="h-3 w-full rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden flex shadow-inner">
                <BarSegment count={statusMap.get("MATCHED") ?? 0} total={transactions.length} bg="bg-emerald-500" />
                <BarSegment count={statusMap.get("AI_MATCHED") ?? 0} total={transactions.length} bg="bg-[#0052FF]" />
                <BarSegment count={statusMap.get("REVIEW") ?? 0} total={transactions.length} bg="bg-amber-500" />
                <BarSegment count={statusMap.get("UNRESOLVED") ?? 0} total={transactions.length} bg="bg-rose-500" />
              </div>

              {/* Detailed Breakdown List */}
              <div className="mt-4 space-y-2">
                <SpectrumRow
                  label="Direct Rule Matched"
                  count={statusMap.get("MATCHED") ?? 0}
                  total={transactions.length}
                  colorDot="bg-emerald-500"
                  active={statusFilter === "MATCHED"}
                  onClick={() => setStatusFilter(statusFilter === "MATCHED" ? "ALL" : "MATCHED")}
                />
                <SpectrumRow
                  label="AI-Assisted Matched"
                  count={statusMap.get("AI_MATCHED") ?? 0}
                  total={transactions.length}
                  colorDot="bg-[#0052FF]"
                  active={statusFilter === "AI_MATCHED"}
                  onClick={() => setStatusFilter(statusFilter === "AI_MATCHED" ? "ALL" : "AI_MATCHED")}
                />
                <SpectrumRow
                  label="Requires Controller Review"
                  count={statusMap.get("REVIEW") ?? 0}
                  total={transactions.length}
                  colorDot="bg-amber-500"
                  active={statusFilter === "REVIEW"}
                  onClick={() => setStatusFilter(statusFilter === "REVIEW" ? "ALL" : "REVIEW")}
                />
                <SpectrumRow
                  label="Unresolved Discrepancies"
                  count={statusMap.get("UNRESOLVED") ?? 0}
                  total={transactions.length}
                  colorDot="bg-rose-500"
                  active={statusFilter === "UNRESOLVED"}
                  onClick={() => setStatusFilter(statusFilter === "UNRESOLVED" ? "ALL" : "UNRESOLVED")}
                />
              </div>
            </div>

            <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between text-[11px] text-slate-500">
              <span>Click a category to filter table</span>
              {statusFilter !== "ALL" && (
                <button
                  type="button"
                  onClick={() => setStatusFilter("ALL")}
                  className="text-[#0052FF] hover:underline font-semibold"
                >
                  Reset Filter (Show All)
                </button>
              )}
            </div>
          </div>
        </section>

        {/* Transaction Explorer (Search, Filter, Table) */}
        <section className="rzp-card p-6 border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#101623] space-y-4">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 border-b border-slate-100 dark:border-slate-800 pb-4">
            <div>
              <div className="flex items-center gap-2">
                <div className="h-2 w-2 rounded-full bg-[#0052FF]" />
                <h2 className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">
                  Transaction Reconciliation Ledger
                </h2>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                Showing {filteredTransactions.length} of {transactions.length} transactions with complete multi-stream audit trail
              </p>
            </div>

            {/* Search & Filter Controls */}
            <div className="flex items-center flex-wrap gap-2.5">
              {/* Search Box */}
              <div className="relative">
                <svg className="absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search ID, merchant, reason..."
                  className="w-56 sm:w-64 rounded-lg bg-slate-50 dark:bg-[#161F30] border border-slate-200 dark:border-slate-700 pl-8 pr-3 py-1.5 text-xs text-slate-800 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:border-[#0052FF] focus:ring-1 focus:ring-[#0052FF]"
                />
              </div>

              {/* Status Filter Pills */}
              <div className="flex rounded-lg bg-slate-100 dark:bg-[#161F30] p-1 border border-slate-200 dark:border-slate-800">
                {(["ALL", "MATCHED", "AI_MATCHED", "REVIEW", "UNRESOLVED"] as const).map((st) => (
                  <button
                    key={st}
                    type="button"
                    onClick={() => setStatusFilter(st)}
                    className={`px-2.5 py-1 text-[11px] font-semibold rounded-md transition-all cursor-pointer ${
                      statusFilter === st
                        ? "bg-[#0052FF] text-white shadow-xs"
                        : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
                    }`}
                  >
                    {st === "ALL" ? "All" : st.replace("_", " ")}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* High Readability Stark White Ledger Table */}
          <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#101623]">
            <table className="min-w-full text-left text-xs">
              <thead className="bg-slate-50 dark:bg-[#161F30] text-slate-600 dark:text-slate-300 border-b border-slate-200 dark:border-slate-800">
                <tr>
                  <th className="py-3 px-4 font-semibold text-slate-800 dark:text-white">Transaction ID</th>
                  <th className="py-3 px-4 font-semibold">Bank Stream</th>
                  <th className="py-3 px-4 font-semibold">Ledger Stream</th>
                  <th className="py-3 px-4 font-semibold">Gateway Record</th>
                  <th className="py-3 px-4 font-semibold">Status</th>
                  <th className="py-3 px-4 font-semibold">Confidence</th>
                  <th className="py-3 px-4 font-semibold">Audit Rationale</th>
                  <th className="py-3 px-4 font-semibold text-right">Inspect</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {filteredTransactions.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-8 text-center text-slate-500">
                      No transactions match the current query or filter.
                    </td>
                  </tr>
                ) : (
                  filteredTransactions.slice(0, 100).map((row) => {
                    const isSelected = selectedTransactionId === row.transactionId;
                    return (
                      <tr
                        key={row.id}
                        onClick={() => fetchTransactionDetail(row.transactionId)}
                        className={`cursor-pointer transition-colors ${
                          isSelected
                            ? "bg-blue-50/80 dark:bg-blue-950/40 border-l-4 border-l-[#0052FF]"
                            : "hover:bg-slate-50 dark:hover:bg-slate-800/50"
                        }`}
                      >
                        <td className="py-3 px-4 font-mono font-medium text-slate-900 dark:text-slate-100 whitespace-nowrap">
                          {row.transactionId}
                        </td>
                        <td className="py-3 px-4 font-mono-numbers text-slate-700 dark:text-slate-300 whitespace-nowrap">
                          {row.bank?.amount ? `₹${Number(row.bank.amount).toFixed(2)}` : <span className="text-slate-400">—</span>}
                        </td>
                        <td className="py-3 px-4 font-mono-numbers text-slate-700 dark:text-slate-300 whitespace-nowrap">
                          {row.ledger?.amount ? `₹${Number(row.ledger.amount).toFixed(2)}` : <span className="text-slate-400">—</span>}
                        </td>
                        <td className="py-3 px-4 font-mono-numbers text-slate-700 dark:text-slate-300 whitespace-nowrap">
                          {row.payments[0]?.amount ? `₹${Number(row.payments[0].amount).toFixed(2)}` : <span className="text-slate-400">—</span>}
                        </td>
                        <td className="py-3 px-4 whitespace-nowrap">
                          <StatusBadge status={row.status} />
                        </td>
                        <td className="py-3 px-4 whitespace-nowrap">
                          <div className="flex items-center gap-2">
                            <div className="h-1.5 w-14 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden">
                              <div
                                className="h-full bg-[#0052FF]"
                                style={{ width: `${Math.round(Number(row.confidence) * 100)}%` }}
                              />
                            </div>
                            <span className="font-mono text-[11px] font-semibold text-slate-700 dark:text-slate-300">
                              {(Number(row.confidence) * 100).toFixed(0)}%
                            </span>
                          </div>
                        </td>
                        <td className="py-3 px-4 text-slate-600 dark:text-slate-300 max-w-xs truncate">
                          {row.reason}
                        </td>
                        <td className="py-3 px-4 text-right whitespace-nowrap">
                          <button
                            type="button"
                            className={`inline-flex items-center justify-center h-6 w-6 rounded-md transition-all ${
                              isSelected
                                ? "bg-[#0052FF] text-white"
                                : "bg-slate-100 dark:bg-slate-800 text-slate-500 hover:text-[#0052FF] hover:bg-slate-200"
                            }`}
                          >
                            <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M9 5l7 7-7 7" />
                            </svg>
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </section>

        {/* Dual Command Section: Exception Management & 3-Way Audit Inspector */}
        <section className="grid gap-6 lg:grid-cols-12">
          {/* Exception Resolution Command (6 Cols) */}
          <div className="lg:col-span-6 rzp-card p-6 border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#101623] space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <div className="h-2 w-2 rounded-full bg-amber-500" />
                <h2 className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">
                  Exception Resolution Command
                </h2>
              </div>
              <span className="rounded-full bg-amber-50 dark:bg-amber-950/60 border border-amber-200 dark:border-amber-800 px-2.5 py-0.5 text-[11px] font-semibold text-amber-700 dark:text-amber-300">
                {exceptions.length} Items Flagged
              </span>
            </div>

            {/* Filter controls */}
            <div className="grid gap-2 sm:grid-cols-3">
              <select
                value={exceptionFilter.type}
                onChange={(e) => {
                  const next = { ...exceptionFilter, type: e.target.value };
                  setExceptionFilter(next);
                  applyExceptionFilter(next);
                }}
                className="rounded-lg bg-slate-50 dark:bg-[#161F30] border border-slate-200 dark:border-slate-700 px-3 py-1.5 text-xs text-slate-700 dark:text-slate-200 focus:outline-none focus:border-[#0052FF]"
              >
                <option value="">All Types</option>
                <option value="AMOUNT_MISMATCH">Amount mismatch</option>
                <option value="MISSING_LEDGER_RECORD">Missing ledger</option>
                <option value="MISSING_BANK_RECORD">Missing bank record</option>
                <option value="MISSING_PAYMENT_RECORD">Missing gateway record</option>
                <option value="DUPLICATE">Duplicate payment</option>
                <option value="AMBIGUOUS_MATCH">Ambiguous match</option>
                <option value="PARTIAL_PAYMENT">Partial payment</option>
                <option value="UNEXPECTED_FEE">Fee variance</option>
                <option value="CURRENCY_MISMATCH">Currency mismatch</option>
              </select>

              <select
                value={exceptionFilter.severity}
                onChange={(e) => {
                  const next = { ...exceptionFilter, severity: e.target.value };
                  setExceptionFilter(next);
                  applyExceptionFilter(next);
                }}
                className="rounded-lg bg-slate-50 dark:bg-[#161F30] border border-slate-200 dark:border-slate-700 px-3 py-1.5 text-xs text-slate-700 dark:text-slate-200 focus:outline-none focus:border-[#0052FF]"
              >
                <option value="">All Severities</option>
                <option value="HIGH">High Severity</option>
                <option value="MEDIUM">Medium Severity</option>
                <option value="LOW">Low Severity</option>
              </select>

              <select
                value={exceptionFilter.status}
                onChange={(e) => {
                  const next = { ...exceptionFilter, status: e.target.value };
                  setExceptionFilter(next);
                  applyExceptionFilter(next);
                }}
                className="rounded-lg bg-slate-50 dark:bg-[#161F30] border border-slate-200 dark:border-slate-700 px-3 py-1.5 text-xs text-slate-700 dark:text-slate-200 focus:outline-none focus:border-[#0052FF]"
              >
                <option value="">All Statuses</option>
                <option value="OPEN">Open (Pending)</option>
                <option value="RESOLVED">Resolved (Approved)</option>
              </select>
            </div>

            {/* Exception cards list */}
            <div className="space-y-3 max-h-[580px] overflow-y-auto pr-1">
              {exceptions.length === 0 ? (
                <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#161F30] p-8 text-center text-slate-500 text-xs">
                  No exceptions matching the current filter.
                </div>
              ) : (
                exceptions.slice(0, 50).map((ex) => {
                  const isResolved = ex.status === "RESOLVED";
                  return (
                    <div
                      key={ex.id}
                      className={`rounded-xl border p-4 transition-all ${
                        isResolved
                          ? "border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/40 opacity-70"
                          : "border-slate-200 dark:border-slate-800 bg-white dark:bg-[#161F30] shadow-xs hover:border-blue-300 dark:hover:border-blue-800"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span className={`inline-block h-2 w-2 rounded-full ${
                            ex.severity === "HIGH" ? "bg-rose-500" : ex.severity === "MEDIUM" ? "bg-amber-500" : "bg-blue-500"
                          }`} />
                          <p className="font-semibold text-xs text-slate-900 dark:text-white">{ex.exceptionType.replace(/_/g, " ")}</p>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <span className="font-mono text-[11px] text-slate-500">{ex.transactionId}</span>
                          <span className={`rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                            ex.severity === "HIGH"
                              ? "bg-rose-50 text-rose-700 border border-rose-200 dark:bg-rose-950/50 dark:text-rose-400 dark:border-rose-900"
                              : ex.severity === "MEDIUM"
                              ? "bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-950/50 dark:text-amber-400 dark:border-amber-900"
                              : "bg-blue-50 text-blue-700 border border-blue-200 dark:bg-blue-950/50 dark:text-blue-400 dark:border-blue-900"
                          }`}>
                            {ex.severity}
                          </span>
                        </div>
                      </div>

                      <p className="mt-2 text-xs text-slate-600 dark:text-slate-300 leading-relaxed">{ex.reason}</p>

                      {ex.amountDifference && (
                        <p className="mt-1 font-mono-numbers text-[11px] text-amber-600 dark:text-amber-400 font-medium">
                          Discrepancy: ₹{Number(ex.amountDifference).toFixed(2)}
                          {ex.dateDifferenceDays ? ` • Date Delta: ${ex.dateDifferenceDays}d` : ""}
                        </p>
                      )}

                      {/* Decision Actions */}
                      {isResolved ? (
                        <div className="mt-3 flex items-center justify-between border-t border-slate-100 dark:border-slate-800 pt-2 text-[11px] text-emerald-600 dark:text-emerald-400 font-medium">
                          <span className="flex items-center gap-1">
                            <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                              <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                            </svg>
                            {ex.humanDecision ?? "Resolved"}
                          </span>
                          <button
                            type="button"
                            onClick={() => updateException(ex.id, "KEEP_EXCEPTION")}
                            className="text-xs text-slate-400 hover:text-slate-600 underline cursor-pointer"
                          >
                            Re-open
                          </button>
                        </div>
                      ) : (
                        <div className="mt-3 flex items-center flex-wrap gap-2 border-t border-slate-100 dark:border-slate-800 pt-2.5">
                          <button
                            type="button"
                            onClick={() => updateException(ex.id, "APPROVE_MATCH")}
                            className="rounded-md bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-300 dark:bg-emerald-950/40 dark:text-emerald-300 px-2.5 py-1 text-[11px] font-semibold transition-all cursor-pointer"
                          >
                            ✓ Approve
                          </button>
                          <button
                            type="button"
                            onClick={() => updateException(ex.id, "REJECT_MATCH")}
                            className="rounded-md bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-300 dark:bg-rose-950/40 dark:text-rose-300 px-2.5 py-1 text-[11px] font-semibold transition-all cursor-pointer"
                          >
                            ✕ Reject
                          </button>
                          <button
                            type="button"
                            onClick={() => updateException(ex.id, "MARK_RESOLVED")}
                            className="rounded-md bg-blue-50 hover:bg-blue-100 text-[#0052FF] border border-blue-200 dark:bg-blue-950/40 dark:text-blue-400 px-2.5 py-1 text-[11px] font-semibold transition-all cursor-pointer"
                          >
                            ✔ Resolve
                          </button>
                          <button
                            type="button"
                            onClick={() => updateException(ex.id, "KEEP_EXCEPTION")}
                            className="rounded-md bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-300 dark:bg-slate-800 dark:text-slate-300 px-2 py-1 text-[11px] font-semibold transition-all cursor-pointer"
                          >
                            Flag
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* 3-Way Comparative Inspector (6 Cols) */}
          <div className="lg:col-span-6 rzp-card p-6 border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#101623] flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3 mb-4">
                <div className="flex items-center gap-2">
                  <div className="h-2 w-2 rounded-full bg-[#0052FF]" />
                  <h2 className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">
                    3-Way Audit & Explainability Matrix
                  </h2>
                </div>
                {selectedTransaction && (
                  <span className="font-mono text-xs font-semibold text-[#0052FF] dark:text-blue-400">
                    {selectedTransaction.result.transactionId}
                  </span>
                )}
              </div>

              {!selectedTransaction ? (
                <div className="rounded-xl border border-dashed border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#161F30] p-12 text-center text-slate-500 space-y-2">
                  <svg className="mx-auto h-8 w-8 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M15 15l-2 5L9 9l11 4-5 2zm0 0l5 5M7.188 2.239l.777 2.897M5.136 7.965l-2.898-.777M13.95 4.05l-2.122 2.122m-5.657 5.656l-2.12 2.122" />
                  </svg>
                  <p className="text-sm text-slate-700 dark:text-slate-200 font-semibold">Select a transaction to inspect</p>
                  <p className="text-xs text-slate-500">
                    Click any transaction row in the ledger to examine its 3-stream multi-source evidence.
                  </p>
                </div>
              ) : (
                <div className="space-y-4">
                  {/* Decision Summary Card */}
                  <div className="rounded-xl bg-slate-50 dark:bg-[#161F30] border border-slate-200 dark:border-slate-800 p-4 space-y-3 shadow-xs">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <StatusBadge status={selectedTransaction.result.status} />
                        <span className="text-xs text-slate-500 font-medium">
                          via <span className="font-semibold text-slate-800 dark:text-slate-200">{selectedTransaction.result.decisionMethod}</span>
                        </span>
                      </div>
                      <div className="text-right">
                        <span className="text-[10px] uppercase text-slate-400 block font-semibold">Confidence</span>
                        <span className="font-mono text-base font-bold text-[#0052FF] dark:text-blue-400">
                          {(Number(selectedTransaction.result.confidence) * 100).toFixed(1)}%
                        </span>
                      </div>
                    </div>

                    <div className="border-t border-slate-200 dark:border-slate-800 pt-2.5 text-xs text-slate-700 dark:text-slate-300">
                      <p className="font-semibold text-slate-800 dark:text-slate-100">Decision Rationale:</p>
                      <p className="mt-0.5 text-slate-600 dark:text-slate-400 leading-relaxed">{selectedTransaction.result.reason}</p>
                    </div>

                    <div className="rounded-lg bg-white dark:bg-[#101623] border border-slate-200 dark:border-slate-800 p-2.5 text-xs flex items-center justify-between">
                      <span className="text-slate-500">Recommended Action:</span>
                      <span className="font-semibold text-slate-900 dark:text-white">{selectedTransaction.result.recommendedAction}</span>
                    </div>
                  </div>

                  {/* 3 Stream Comparative Records */}
                  <div className="grid gap-3 sm:grid-cols-3">
                    {/* Bank Card */}
                    <div className="rounded-xl bg-slate-50 dark:bg-[#161F30] border border-slate-200 dark:border-slate-800 p-3 space-y-1.5 shadow-xs">
                      <div className="flex items-center justify-between text-[11px] text-[#0052FF] dark:text-blue-400 font-bold uppercase tracking-wider">
                        <span>Bank Stream</span>
                        <span className="text-[10px] text-slate-400 font-normal">Statement</span>
                      </div>
                      {selectedTransaction.bank ? (
                        <div className="text-xs space-y-1">
                          <p className="font-mono-numbers text-base font-bold text-slate-900 dark:text-white">
                            ₹{Number(selectedTransaction.bank.amount).toFixed(2)}
                          </p>
                          <p className="text-slate-700 dark:text-slate-300 truncate font-medium" title={selectedTransaction.bank.description}>
                            {selectedTransaction.bank.description}
                          </p>
                          <p className="text-[11px] text-slate-500 font-mono">
                            Ref: {selectedTransaction.bank.reference || "N/A"}
                          </p>
                          <p className="text-[10px] text-slate-400">
                            Date: {selectedTransaction.bank.transactionDate}
                          </p>
                        </div>
                      ) : (
                        <p className="text-xs text-rose-600 dark:text-rose-400 py-4 text-center font-medium">Missing in Bank</p>
                      )}
                    </div>

                    {/* Ledger Card */}
                    <div className="rounded-xl bg-slate-50 dark:bg-[#161F30] border border-slate-200 dark:border-slate-800 p-3 space-y-1.5 shadow-xs">
                      <div className="flex items-center justify-between text-[11px] text-indigo-600 dark:text-indigo-400 font-bold uppercase tracking-wider">
                        <span>Ledger Stream</span>
                        <span className="text-[10px] text-slate-400 font-normal">Internal</span>
                      </div>
                      {selectedTransaction.ledger ? (
                        <div className="text-xs space-y-1">
                          <p className="font-mono-numbers text-base font-bold text-slate-900 dark:text-white">
                            ₹{Number(selectedTransaction.ledger.amount).toFixed(2)}
                          </p>
                          <p className="text-slate-700 dark:text-slate-300 truncate font-medium" title={selectedTransaction.ledger.description}>
                            {selectedTransaction.ledger.description}
                          </p>
                          <p className="text-[11px] text-slate-500 font-mono">
                            Inv: {selectedTransaction.ledger.invoiceNumber || "N/A"}
                          </p>
                          <p className="text-[10px] text-slate-400">
                            Vendor: {selectedTransaction.ledger.vendor || "N/A"}
                          </p>
                        </div>
                      ) : (
                        <p className="text-xs text-rose-600 dark:text-rose-400 py-4 text-center font-medium">Missing in Ledger</p>
                      )}
                    </div>

                    {/* Payment Card */}
                    <div className="rounded-xl bg-slate-50 dark:bg-[#161F30] border border-slate-200 dark:border-slate-800 p-3 space-y-1.5 shadow-xs">
                      <div className="flex items-center justify-between text-[11px] text-teal-600 dark:text-teal-400 font-bold uppercase tracking-wider">
                        <span>Gateway Stream</span>
                        <span className="text-[10px] text-slate-400 font-normal">Razorpay</span>
                      </div>
                      {selectedTransaction.payments.length > 0 ? (
                        selectedTransaction.payments.map((p: any) => (
                          <div key={p.id} className="text-xs space-y-1">
                            <p className="font-mono-numbers text-base font-bold text-slate-900 dark:text-white">
                              ₹{Number(p.amount).toFixed(2)}
                            </p>
                            <p className="text-slate-700 dark:text-slate-300 truncate font-medium" title={p.merchant}>
                              {p.merchant}
                            </p>
                            <p className="text-[11px] text-slate-500 font-mono">
                              Ref: {p.reference || "N/A"}
                            </p>
                            <p className="text-[10px] text-slate-400">
                              Status: {p.status}
                            </p>
                          </div>
                        ))
                      ) : (
                        <p className="text-xs text-rose-600 dark:text-rose-400 py-4 text-center font-medium">Missing in Gateway</p>
                      )}
                    </div>
                  </div>

                  {/* Audit Trail Timeline */}
                  {selectedTransaction.audit && selectedTransaction.audit.length > 0 && (
                    <div className="rounded-xl bg-slate-50 dark:bg-[#161F30] border border-slate-200 dark:border-slate-800 p-3.5 space-y-2">
                      <p className="text-[11px] font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">
                        Audit Trail & Stage-by-Stage Verification
                      </p>
                      <div className="space-y-1.5 text-xs">
                        {selectedTransaction.audit.map((step: any, idx: number) => (
                          <div key={idx} className="flex items-start gap-2 text-slate-600 dark:text-slate-400">
                            <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-[#0052FF]" />
                            <div>
                              <span className="font-semibold text-slate-800 dark:text-slate-200">Stage: {step.stage}</span>
                              <p className="text-[11px] text-slate-500 dark:text-slate-400">{step.details?.reason ?? JSON.stringify(step.details)}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800 text-[11px] text-slate-400 flex items-center justify-between">
              <span>Ground truth verifiable</span>
              <span>100% auditable decisions</span>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}

// Subcomponents

function KpiCard({
  title,
  value,
  subtitle,
  icon,
  iconColor,
}: {
  title: string;
  value: string;
  subtitle: string;
  icon: React.ReactNode;
  iconColor: string;
}) {
  return (
    <article className="rzp-card p-5 border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#101623] shadow-xs flex flex-col justify-between transition-all hover:border-slate-300 dark:hover:border-slate-700">
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">{title}</p>
        <div className={`rounded-lg p-2 ${iconColor}`}>{icon}</div>
      </div>
      <div className="mt-3">
        <p className="text-2xl font-extrabold tracking-tight font-mono-numbers text-slate-900 dark:text-slate-50">
          {value}
        </p>
        <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400 truncate">{subtitle}</p>
      </div>
    </article>
  );
}

function StatusBadge({ status }: { status: string }) {
  if (status === "MATCHED") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-300 dark:border-emerald-800 px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
        Matched
      </span>
    );
  }
  if (status === "AI_MATCHED") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-blue-50 text-[#0052FF] border border-blue-200 dark:bg-blue-950/50 dark:text-blue-300 dark:border-blue-800 px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider">
        <span className="h-1.5 w-1.5 rounded-full bg-[#0052FF] animate-pulse" />
        AI Matched
      </span>
    );
  }
  if (status === "REVIEW") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-950/50 dark:text-amber-300 dark:border-amber-800 px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider">
        <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
        Review
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-rose-50 text-rose-700 border border-rose-200 dark:bg-rose-950/50 dark:text-rose-300 dark:border-rose-800 px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider">
      <span className="h-1.5 w-1.5 rounded-full bg-rose-500" />
      Unresolved
    </span>
  );
}

function BarSegment({ count, total, bg }: { count: number; total: number; bg: string }) {
  if (total <= 0 || count <= 0) return null;
  const pct = (count / total) * 100;
  return (
    <div
      className={`h-full ${bg} transition-all duration-500`}
      style={{ width: `${pct}%` }}
      title={`${count} items (${pct.toFixed(1)}%)`}
    />
  );
}

function SpectrumRow({
  label,
  count,
  total,
  colorDot,
  active,
  onClick,
}: {
  label: string;
  count: number;
  total: number;
  colorDot: string;
  active: boolean;
  onClick: () => void;
}) {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
  return (
    <div
      onClick={onClick}
      className={`flex items-center justify-between rounded-lg p-2 text-xs cursor-pointer transition-all ${
        active
          ? "bg-blue-50 dark:bg-blue-950/50 border border-blue-200 dark:border-blue-800 font-semibold text-[#0052FF] dark:text-blue-300"
          : "hover:bg-slate-50 dark:hover:bg-slate-800/60 text-slate-700 dark:text-slate-300 border border-transparent"
      }`}
    >
      <div className="flex items-center gap-2">
        <span className={`h-2 w-2 rounded-full ${colorDot}`} />
        <span>{label}</span>
      </div>
      <div className="flex items-center gap-3">
        <span className="font-mono text-slate-400">{count}</span>
        <span className="font-mono font-bold text-slate-700 dark:text-slate-200 w-9 text-right">{pct}%</span>
      </div>
    </div>
  );
}

function UploadSlot({
  label,
  fileName,
  onChange,
}: {
  label: string;
  fileName?: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
}) {
  return (
    <label className="flex flex-col items-center justify-center rounded-lg border border-dashed border-slate-300 dark:border-slate-700 bg-slate-50/50 dark:bg-[#161F30] p-3 text-center cursor-pointer transition-all hover:border-[#0052FF] hover:bg-blue-50/30 dark:hover:bg-blue-950/20">
      <svg className="h-4 w-4 text-[#0052FF] mb-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
      </svg>
      <span className="text-[11px] font-semibold text-slate-700 dark:text-slate-200">{label}</span>
      <span className="text-[10px] text-slate-400 mt-0.5 truncate max-w-[120px]">
        {fileName || "Select .csv"}
      </span>
      <input type="file" accept=".csv" onChange={onChange} className="hidden" />
    </label>
  );
}
