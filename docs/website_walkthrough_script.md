# Website Walkthrough Script: AI Finance Controller & Reconciliation Agent

> **Target Medium**: Live Product Demo, Video Screen Recording, or Hackathon Walkthrough  
> **Target Duration**: 3 to 4.5 minutes (can be shortened or expanded)  
> **Application URL**: `http://localhost:3000`  
> **Visual Theme**: Razorpay Blade Enterprise Fintech UI

---

## Walkthrough Roadmap & Quick Reference

```
[Header & Blade UI] ──> [Data Stream Ingestion] ──> [One-Click Reconciliation]
         │                                                      │
[Theme Toggle: Dark Mode] <── [AI Deep-Dive Drawer] <── [Ledger Table & Filters]
```

---

## Scene 1: Header & Enterprise Design Foundation (0:00 – 0:30)

### On-Screen Action:
- Open `http://localhost:3000` in fullscreen browser.
- Hover cursor over the top navigation bar, highlighting the Razorpay Blue logo emblem and the live system pills.

### Spoken Narration:
> *"Welcome to the **AI Finance Controller & Reconciliation Agent**.*
>
> *We designed this platform from the ground up using the **Razorpay Blade enterprise design language**—focusing on high trust, zero cognitive clutter, and maximum data density for controllers.*
>
> *At the top, you can see our live system indicator: our dual ML models trained on 500,000 transactions are primed, and our embedded zero-setup database is ready to ingest multi-channel feeds."*

---

## Scene 2: The Ingestion Hub & 3 Financial Streams (0:30 – 1:15)

### On-Screen Action:
- Scroll slightly down to the **Ingestion & Controls** bar.
- Point cursor to the three distinct stream slots: **Bank Statement**, **Internal ERP Ledger**, and **Razorpay Gateway**.
- Hover over the batch size dropdown (e.g., selecting 250 or 500 transactions).

### Spoken Narration:
> *"Reconciliation fails today because modern commerce is multi-stream.*
>
> *Here, the controller has two options: upload real CSV feeds or generate high-fidelity synthetic production streams representing typical Indian fintech volume.*
>
> *Notice the three distinct streams our pipeline unifies:*
> 1. *The **Bank Statement** feed—with raw narration strings, IMPS/NEFT transfers, and 12-digit UTR references.*
> 2. *The **Internal ERP Ledger**—containing vendor invoices, purchase orders, and general ledger dates.*
> 3. *And the **Razorpay Gateway** feed—with `pay_` transaction IDs, declared Merchant Discount Rates (MDR), and statutory 18% GST splits.*
>
> *Now, let’s run the reconciliation engine."*

---

## Scene 3: One-Click Autonomous Reconciliation (1:15 – 1:55)

### On-Screen Action:
- Move cursor to the primary call-to-action button: **"Run Reconciliation"** (Razorpay Blue `#0052FF`).
- **Click the button**.
- Pause for 1–2 seconds as the loading state pulses and the dashboard recalculates and re-animates.

### Spoken Narration:
> *"[Click 'Run Reconciliation']*
>
> *With a single click, our multi-stage pipeline executes in less than two seconds.*
>
> *In that split second, the engine:*
> - *Fuzzy-normalizes merchant aliases and extracts banking UTRs,*
> - *Audits settlement date drift against Indian banking calendars and bank holidays,*
> - *Calculates exact MDR rates and GST compliance,*
> - *And invokes our dual 500K-trained ML models to resolve borderline discrepancies."*

---

## Scene 4: The 5 Uniform KPI Cards & Match Spectrum (1:55 – 2:40)

### On-Screen Action:
- Sweep cursor across the **5 KPI Metric Cards** across the top of the dashboard.
- Then point to the **Match Spectrum** and **Anomaly Breakdown** panel on the left.

### Spoken Narration:
> *"Immediately, the executive controller gets an instant health check across 5 uniform KPI metrics:*
> - *First, **Total Volume Processed**—tracking total gross turnover.*
> - *Second, our **Auto-Match Rate**—consistently above 95% straight-through processing.*
> - *Third, **Unmatched Exceptions**—flagging items that require human controller sign-off.*
> - *Fourth, **Fee & Tax Variance**—identifying any unauthorized gateway deductions down to the rupee.*
> - *And fifth, **Average AI Confidence**—standing at over 98%.*
>
> *On the left panel, our **Match Spectrum** categorizes the batch: exact deterministic matches, high-confidence AI-matched pairs, items flagged for review, and unresolved records.*
>
> *Below that, the **Anomaly Breakdown** isolates the root causes: whether an error is an Amount Mismatch, a Timing Delay, an MDR Fee Variance, or a Duplicate Entry."*

---

## Scene 5: The 3-Way Multi-Column Ledger & Smart Filters (2:40 – 3:30)

### On-Screen Action:
- Scroll down to the **Multi-Stream Reconciliation Table**.
- Click the filter tabs one by one:
  1. Click **"Auto-Matched"** (show green badges).
  2. Click **"AI Matched"** (show blue badges).
  3. Click **"Review Required"** (show amber badges).
  4. Click **"Unresolved"** (show red badges).
- Type a sample query (like `"RZP"` or a specific amount) into the search bar.

### Spoken Narration:
> *"Now let's examine the dense financial ledger.*
>
> *Each row aligns the three worlds side-by-side: Bank Narration, ERP Ledger, and Razorpay Settlement.*
>
> *Notice our instant controller status signals:*
> - ***Green Badges*** *indicate clean 100% straight-through matches.*
> - ***Blue Badges*** *represent AI-Matched decisions, where slight narration typos or timing variances were correctly bridged by our ML classifier.*
> - ***Amber Badges*** *highlight pending approvals where human discretion is required.*
> - *And ***Red Badges*** *flag true accounting discrepancies.*
>
> *We can easily slice the ledger using smart tabs—filtering to only exceptions or searching by UTR or transaction ID."*

---

## Scene 6: Deep-Dive Audit Drawer & Automated Recommendations (3:30 – 4:15)

### On-Screen Action:
- Click on any row in the table (preferably an **"AI Matched"** or **"Review Required"** row).
- The **Detail Audit Drawer** slides out from the right side of the screen.
- Scroll through the drawer, pointing to:
  1. The 3-way side-by-side data comparison.
  2. The ML Confidence score breakdown.
  3. The automated **"Recommended Action"** box.
  4. The timestamped **Audit Trail** at the bottom.

### Spoken Narration:
> *"[Click a row to open Drawer]*
>
> *Clicking any entry opens the **Controller Inspection Drawer**.*
>
> *Instead of digging through multiple browser tabs or ERP menus, the controller sees a complete forensic breakdown in one place:*
> - *Here is the exact bank narration with extracted UTR.*
> - *Here is the internal ERP invoice.*
> - *And here is the Razorpay settlement showing gross, net, and the exact MDR fee deduction.*
>
> *Look at our AI explanation: the model doesn’t just output a number; it provides an explicit rationale—for instance: 'Amounts match perfectly; bank settlement arrived on Monday following a 2nd Saturday banking holiday; MDR calculated at standard 2% with 18% GST'.*
>
> *It then suggests the exact accounting entry to post, backed by a cryptographically verifiable audit log."*

---

## Scene 7: Blade Dark Mode & Closing (4:15 – 4:45)

### On-Screen Action:
- Close the drawer.
- Move cursor to the header and click the **Sun/Moon Theme Toggle** button.
- The UI instantly shifts into **Razorpay Blade Dark Mode** (midnight navy `#0A0D14` and `#101623`).
- Scroll smoothly across the dark mode ledger.

### Spoken Narration:
> *"[Click Sun/Moon toggle]*
>
> *Finally, because finance controllers and audit teams often work late-night quarters during fiscal close, one click toggles into **Razorpay Blade Dark Mode**.*
>
> *Every single status signal, ledger border, and monospace figure is optimized with high-contrast dark tokens to eliminate eye strain while maintaining total financial clarity.*
>
> *That is the **AI Finance Controller & Reconciliation Agent**: turning multi-day spreadsheet chaos into instant, autonomous, audit-ready financial certainty.*
>
> *Thank you!"*

---

## Presenter Cheat-Sheet: What to Click & When

| Step # | Timestamp | On-Screen Click Target | Key Verbal Cue |
| :---: | :---: | :--- | :--- |
| **1** | **0:15** | Header Brand Area | *"Razorpay Blade design language..."* |
| **2** | **0:50** | Ingestion Stream Cards | *"Bank, ERP Ledger, and Razorpay Gateway..."* |
| **3** | **1:15** | **"Run Reconciliation" Button** | *"With a single click..."* |
| **4** | **2:00** | 5 Top KPI Cards | *"Auto-match rate above 95%..."* |
| **5** | **2:50** | Filter Tabs ("AI Matched", "Review") | *"Notice our instant status signals..."* |
| **6** | **3:35** | Any Table Row (Open Drawer) | *"Complete forensic breakdown in one place..."* |
| **7** | **4:20** | **Theme Toggle Button (Sun/Moon)** | *"Razorpay Blade Dark Mode for late-night close..."* |
