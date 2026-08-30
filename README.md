# Fineatch AI — Finance Operations Controller

> **Client-side bank, GL & AP reconciliation engine with an automated batch resolution agent, composite scoring, and web dataset search.**

Fineatch AI closes the finance-ops loop by automatically matching Bank transactions, GL journal entries, and AP invoices, calculating composite dataset health scores, and resolving open exceptions with actionable instructions or honest escalation notes.

---

## ⚡ Key Features

- 🎯 **3-Pass Matching Engine**:
  - **Pass 1 Exact (100%)**: Payment reference & exact amount matching.
  - **Pass 2 Fuzzy (70–99%)**: Amount tolerance (0.5%), date proximity (3 days), narration similarity.
  - **Pass 3 Heuristic (40–69%)**: Vendor name & counterparty matching.
- 🤖 **Batch Finance-Ops Agent (`FinAgentV1`)**:
  - Automatically resolves resolvable exceptions (rounding, minor date gaps, split payments) with concrete action steps.
  - Escalates complex/high-risk exceptions with transparent escalation notes.
  - Computes **Agent Coverage Rate**.
- 📊 **Dataset Scoreboard (0–100 Composite Score)**:
  - Scores datasets based on *Match Rate* (40%), *AP Settlement* (25%), *Agent Coverage* (20%), and *Exception Penalty* (15%).
  - Features visual SVG score rings and aggregate metrics across synthetic, imported, and web datasets.
- 🌐 **Web Dataset Search & CSV Import**:
  - Drag & drop local Bank, GL, and AP CSV files with header auto-detection.
  - Search public web financial datasets or fetch live CSV/API links (`https://...`).
  - Includes Quick Web Dataset presets (`🌐 Tech Corp Bank Statement`, `🌐 Enterprise GL Ledger`, `🌐 Global Vendors AP Invoices`).
- 📈 **30-Day Cash Position Forecaster**:
  - Projects cash balance trajectories with p10–p90 uncertainty confidence bands.
- ⚖️ **GST & TDS Tax Classifier**:
  - Auto-checks GL accounts against tax eligibility rules (GST-ITC, TDS-192) and flags exposure anomalies.
- 💬 **Offline Settlement Q&A Engine**:
  - Rule-based query router answering natural-language questions about transaction IDs, exceptions, cash outlooks, and web dataset searches.

---

## 🚀 How to Run

### Quick Start (Zero Dependencies)

1. Open [`finance-controller/index.html`](file:///c:/Users/bhanu/OneDrive/Desktop/Projects/Fineatch%20AI/finance-controller/index.html) in any web browser.
2. The app initializes in **Zero State** (Match Rate: `0.0%`, Records: `0`, Scores: `0`).
3. Click **▶ Run Reconciliation** to generate synthetic benchmark data and calculate scores.

### Custom Data & Web Search Workflow

1. Go to the **⊕ Import Data** tab.
2. Drag & drop local CSV files or enter a public Web CSV URL / search query.
3. Click **▶ Run on imported data** to execute the pipeline and view composite scores in **◈ Dataset Scores**.

---

## 📁 Project Architecture

```
finance-controller/
├── index.html              Main web application shell
├── css/
│   └── styles.css          Design system (dark theme, SVG score rings, cards)
└── js/
    ├── app.js              UI orchestrator, event handlers, zero-state initialization
    ├── agent.js            FinAgentV1 batch resolution agent & coverage calculator
    ├── reconciler.js       3-pass bank ↔ GL ↔ AP reconciliation engine
    ├── data.js             Deterministic PRNG synthetic dataset generator (Seed #84231)
    ├── importer.js         CSV parser, schema auto-detector & web dataset generator
    ├── forecaster.js       30-day cash position & p10-p90 confidence band forecaster
    ├── tax_matcher.js      GST & TDS tax classification & exposure flagger
    └── qa_agent.js         Offline settlement Q&A natural language router
```

---

## 📊 Score & Exception Taxonomy

### Composite Score Formula (0–100)

$$\text{Score} = (\text{Match Rate} \times 40) + (\text{AP Settlement} \times 25) + (\text{Agent Coverage} \times 20) + (15 - \text{Exception Penalty})$$

### Exception Reason Codes

| Reason Code | Trigger Condition | Auto-Resolution Behavior |
|---|---|---|
| `AMT_MISMATCH` | Amount gap > 0.5% | Resolved if gap < 5% (TDS / rounding) |
| `DATE_GAP` | Date difference > 3 days | Resolved if ≤ 7 days (NEFT timing) |
| `NO_REF` | Missing payment reference | Resolved if vendor & amount match |
| `DUPE_CANDIDATE` | Two GL lines match 1 debit | **Always Escalated** (Human sign-off required) |
| `FX_VARIANCE` | FX rate mismatch | Resolved if variance < 2% (FX gain/loss) |
| `SPLIT_PAYMENT` | 1 debit = multiple AP invoices | Resolved if sum of AP legs matches debit |
| `ADVANCE_PAYMENT` | Bank debit before invoice | Resolved conditionally on timing |

---

*Fineatch AI · All processing is local · No API keys · No external network dependency.*
