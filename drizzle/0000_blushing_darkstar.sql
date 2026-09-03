CREATE TABLE "audit_trail" (
	"id" serial PRIMARY KEY NOT NULL,
	"run_id" integer NOT NULL,
	"transaction_id" text NOT NULL,
	"stage" text NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bank_transactions" (
	"id" serial PRIMARY KEY NOT NULL,
	"run_id" integer NOT NULL,
	"bank_transaction_id" text NOT NULL,
	"transaction_date" date NOT NULL,
	"value_date" date NOT NULL,
	"description" text NOT NULL,
	"reference" text,
	"amount" numeric(14, 2) NOT NULL,
	"currency" varchar(3) NOT NULL,
	"transaction_type" text NOT NULL,
	"account_number_masked" text NOT NULL,
	"normalized_merchant" text NOT NULL,
	"normalized_reference" text,
	"synthetic_txn_id" text
);
--> statement-breakpoint
CREATE TABLE "exceptions" (
	"id" serial PRIMARY KEY NOT NULL,
	"run_id" integer NOT NULL,
	"exception_id" text NOT NULL,
	"transaction_id" text NOT NULL,
	"exception_type" text NOT NULL,
	"severity" text NOT NULL,
	"status" text DEFAULT 'OPEN' NOT NULL,
	"confidence" numeric(5, 4) NOT NULL,
	"amount_difference" numeric(14, 2),
	"date_difference_days" integer,
	"reason" text NOT NULL,
	"recommended_action" text NOT NULL,
	"source_records" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"human_decision" text,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ledger_entries" (
	"id" serial PRIMARY KEY NOT NULL,
	"run_id" integer NOT NULL,
	"ledger_entry_id" text NOT NULL,
	"transaction_date" date NOT NULL,
	"description" text NOT NULL,
	"invoice_number" text,
	"amount" numeric(14, 2) NOT NULL,
	"currency" varchar(3) NOT NULL,
	"accounting_category" text NOT NULL,
	"vendor" text NOT NULL,
	"normalized_merchant" text NOT NULL,
	"normalized_reference" text,
	"synthetic_txn_id" text
);
--> statement-breakpoint
CREATE TABLE "payment_records" (
	"id" serial PRIMARY KEY NOT NULL,
	"run_id" integer NOT NULL,
	"payment_id" text NOT NULL,
	"payment_date" date NOT NULL,
	"merchant" text NOT NULL,
	"reference" text,
	"amount" numeric(14, 2) NOT NULL,
	"currency" varchar(3) NOT NULL,
	"status" text NOT NULL,
	"settlement_date" date NOT NULL,
	"fee_amount" numeric(14, 2),
	"normalized_merchant" text NOT NULL,
	"normalized_reference" text,
	"synthetic_txn_id" text
);
--> statement-breakpoint
CREATE TABLE "reconciliation_results" (
	"id" serial PRIMARY KEY NOT NULL,
	"run_id" integer NOT NULL,
	"transaction_id" text NOT NULL,
	"bank_record_id" integer,
	"ledger_record_id" integer,
	"payment_record_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text NOT NULL,
	"confidence" numeric(5, 4) NOT NULL,
	"decision_method" text NOT NULL,
	"reason" text NOT NULL,
	"evidence" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"recommended_action" text NOT NULL,
	"expected_status" text,
	"is_correct" boolean,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reconciliation_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"batch_name" text NOT NULL,
	"source_type" text DEFAULT 'synthetic' NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	"records_processed" integer DEFAULT 0 NOT NULL,
	"rule_processing_ms" integer DEFAULT 0 NOT NULL,
	"ai_processing_ms" integer DEFAULT 0 NOT NULL,
	"total_processing_ms" integer DEFAULT 0 NOT NULL,
	"metrics" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audit_trail" ADD CONSTRAINT "audit_trail_run_id_reconciliation_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."reconciliation_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_run_id_reconciliation_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."reconciliation_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exceptions" ADD CONSTRAINT "exceptions_run_id_reconciliation_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."reconciliation_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_run_id_reconciliation_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."reconciliation_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_records" ADD CONSTRAINT "payment_records_run_id_reconciliation_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."reconciliation_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconciliation_results" ADD CONSTRAINT "reconciliation_results_run_id_reconciliation_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."reconciliation_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconciliation_results" ADD CONSTRAINT "reconciliation_results_bank_record_id_bank_transactions_id_fk" FOREIGN KEY ("bank_record_id") REFERENCES "public"."bank_transactions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconciliation_results" ADD CONSTRAINT "reconciliation_results_ledger_record_id_ledger_entries_id_fk" FOREIGN KEY ("ledger_record_id") REFERENCES "public"."ledger_entries"("id") ON DELETE set null ON UPDATE no action;