# Fineatch AI — Finance Operations Controller

> **Client-side bank, GL & AP reconciliation engine with a 3-pass matching engine, batch resolution agent, composite scoring, and web dataset search.**

**[▶ Live Demo →  https://tarunmavuri.github.io/Fineatch-AI/](https://tarunmavuri.github.io/Fineatch-AI/)** &nbsp;·&nbsp; No API keys &nbsp;·&nbsp; No server &nbsp;·&nbsp; Open `index.html` and it runs.

---

## ⚡ Features

- **3-Pass Reconciliation Engine** — Exact (100%), Fuzzy (70–99%), Heuristic (40–69%) matching across Bank, GL & AP records
- **Batch Resolution Agent (`FinAgentV1`)** — Auto-resolves exceptions (rounding, date gaps, split payments, FX variance); escalates unresolvable items with typed reasons — never hides failures
- **Composite Dataset Scoreboard** — 0–100 score per dataset based on match rate (40%), AP settlement (25%), agent coverage (20%), exception penalty (15%); SVG score rings with color-coded health bands
- **Web Dataset Search & Fetch** — Enter any public CSV URL or search query; one-click Quick Web Dataset presets (Tech Corp Bank Statement, Enterprise GL Ledger, Global Vendors AP)
- **Local CSV Import** — Drag & drop Bank, GL, AP files with automatic schema detection from column headers
- **30-Day Cash Forecaster** — Forward cash position model with p10–p90 uncertainty bands
- **Tax Classifier** — GST-ITC, TDS-192, GST-OUT GL classification with account mismatch & exposure flagging
- **Offline Q&A Agent** — Rule-based natural language router for transaction lookups, exception queries, cash outlook
- **Zero-State Init** — All KPIs, charts, and scores start at `0` until **▶ Run** is clicked
- **ⓘ How It Works panel** — Inline pipeline walkthrough & file reference, toggled from the header

---

## 🚀 Quick Start

```bash
# No install needed — just open in any browser
open index.html
```

Or deploy to GitHub Pages:
1. Push to a GitHub repo
2. Go to **Settings → Pages → Branch: `master` → `/` (root)**
3. Live at `https://<username>.github.io/<repo>/`

---

## 📁 File Reference

```
├── index.html              Main app shell (header, tabs, KPI strip, panels, Q&A dock)
├── README.md
├── css/
│   └── styles.css          Carbon Intelligence design system (dark theme, acid/violet palette)
└── js/
    ├── data.js             Mulberry32 PRNG synthetic dataset generator — seed #84231
    ├── reconciler.js       3-pass bank ↔ GL ↔ AP matching engine
    ├── agent.js            FinAgentV1 — batch exception resolution & escalation
    ├── forecaster.js       30-day cash position model with p10–p90 bands
    ├── tax_matcher.js      GST & TDS GL classification & exposure flagger
    ├── importer.js         CSV parser, schema auto-detector & web dataset presets
    ├── qa_agent.js         Offline rule-based settlement Q&A router
    └── app.js              UI orchestrator — zero-state init, render loop, event wiring
```

---

## 📊 Score Formula & Exception Codes

### Composite Score (0–100)

| Component | Weight |
|---|---|
| Match Rate (bank ↔ GL) | 40% |
| AP Settlement Rate | 25% |
| Agent Coverage Rate | 20% |
| Exception Penalty | 15% |

**80–100** 🟢 Strong &nbsp;·&nbsp; **60–79** 🟡 Acceptable &nbsp;·&nbsp; **0–59** 🔴 Investigate

### Exception Reason Codes

| Code | Trigger | Auto-Resolved? |
|---|---|---|
| `AMT_MISMATCH` | Amount gap > 0.5% | ✓ if gap < 5% |
| `DATE_GAP` | Date diff > 3 days | ✓ if ≤ 7 days |
| `NO_REF` | Missing payment reference | ✓ if vendor + amount match |
| `DUPE_CANDIDATE` | Two GL lines match 1 bank debit | ✗ Always escalated |
| `FX_VARIANCE` | FX rate mismatch | ✓ if variance < 2% |
| `SPLIT_PAYMENT` | 1 debit = multiple AP invoices | ✓ if sum of legs matches |
| `ADVANCE_PAYMENT` | Bank debit before invoice date | Conditional |

---

## 🔗 Links

- **Live App**: [tarunmavuri.github.io/Fineatch-AI](https://tarunmavuri.github.io/Fineatch-AI/)
- **Repo**: [github.com/tarunmavuri/Fineatch-AI](https://github.com/tarunmavuri/Fineatch-AI)

---

*Fineatch AI · All processing is local · No API keys · No external network dependency*
