# Fineatch AI — Finance Operations Controller

<div align="center">

[![Live Demo](https://img.shields.io/badge/Live_Demo-Open_App-06b6d4?style=flat-square&logo=googlechrome&logoColor=white)](https://tarunmavuri.github.io/Fineatch-AI/)
[![Version](https://img.shields.io/badge/Version-1.0.0-22d3ee?style=flat-square)](https://github.com/tarunmavuri/Fineatch-AI)
[![License](https://img.shields.io/badge/License-MIT-38bdf8?style=flat-square)](LICENSE)
[![Zero Backend](https://img.shields.io/badge/Architecture-100%25_Client--Side-4ade80?style=flat-square)](#)

**Fast, client-side Bank · GL · AP reconciliation engine featuring a 3-pass matching algorithm, autonomous batch resolution agent, and dynamic score gauge.**

[**▶ Launch Live App**](https://tarunmavuri.github.io/Fineatch-AI/) • [Report Bug](https://github.com/tarunmavuri/Fineatch-AI/issues) • [Source Code](https://github.com/tarunmavuri/Fineatch-AI)

</div>

---

## ⚡ Features

- **3-Pass Matching Engine** — Exact (100%), Fuzzy (70–89%), and Heuristic (40–69%) multi-source reconciliation across Bank, GL, and AP records.
- **FinAgentV1 Resolution Agent** — Auto-resolves common variances (rounding, NEFT date gaps, split invoices, FX gains/losses) and transparently escalates high-risk anomalies for human audit.
- **Live Circular Score Gauge** — Real-time dual-ring SVG gauge (`0–100%`) with dynamic color bands and differential delta tracking ($\Delta \pm\%$).
- **Dataset Sourcing & Deduplication** — Built-in PRNG synthetic stream (`Mulberry32`), FNV-1a content hashing to discard duplicates, and public web dataset fetching.
- **Financial Intelligence Tools** — 30-day cash position forecaster with $p_{10}$–$p_{90}$ probability bands, tax classifier (GST-ITC, TDS-192, GST-OUT), and an offline rule-based settlement Q&A assistant.
- **100% Client-Side Privacy** — Zero backend, zero API keys, and zero data exfiltration. All computation runs entirely inside your browser.

---

## 🚀 Quick Start

No installations, build steps, or backend required.

```bash
# Clone and run
git clone https://github.com/tarunmavuri/Fineatch-AI.git
cd Fineatch-AI

# Open in your browser
open index.html        # macOS
start index.html       # Windows
```

Or visit the hosted version directly on **[GitHub Pages](https://tarunmavuri.github.io/Fineatch-AI/)**.

---

## 📊 Matching & Resolution Overview

| Pass / Code | Type / Trigger | Confidence | Action / Resolution |
| :--- | :--- | :---: | :--- |
| **Pass 1: Exact** | Reference ID + Amount | `100%` | Automatic full match |
| **Pass 2: Fuzzy** | Amount $\pm 0.5\%$ + Date $\le 3\text{d}$ | `70–89%` | Matched with variance flag |
| **Pass 3: Heuristic** | Counterparty / Vendor Name | `40–69%` | Matched via tokenized entity similarity |
| `AMT_MISMATCH` | Value discrepancy $> 0.5\%$ | — | Auto-resolved if gap $< 5\%$ (e.g. TDS / rounding) |
| `DATE_GAP` | Value date gap $> 3\text{ days}$ | — | Auto-resolved if gap $\le 7\text{ days}$ (banking cutoff) |
| `DUPE_CANDIDATE` | Multiple GL entries for 1 bank debit | — | **Escalated** — Flagged for manual controller reversal |
| `SPLIT_PAYMENT` | 1 debit across multiple AP bills | — | Auto-resolved if sum of legs equals debit |

---

## 📁 Repository Structure

```
Fineatch-AI/
├── index.html        # App shell, KPI metrics, control bar & panels
├── css/styles.css    # Dark Precision design system & animations
└── js/
    ├── reconciler.js # 3-pass multi-source matching engine
    ├── agent.js      # FinAgentV1 batch exception resolution
    ├── forecaster.js # 30-day cash forecast model (p10–p90)
    ├── tax_matcher.js# GST & TDS exposure classification
    ├── importer.js   # CSV schema parser & web dataset fetcher
    ├── qa_agent.js   # Offline settlement Q&A router
    ├── data.js       # Mulberry32 PRNG synthetic dataset generator
    └── app.js        # UI orchestrator & reactive state management
```

---

## 🛠 Tech Stack

- **Core**: Vanilla JavaScript (ES6+), HTML5, CSS3
- **Graphics**: HTML5 Canvas & Dynamic SVG
- **Design Tokens**: Dark Precision (`#0B0C0E` base, `#22D3EE` cyan hero, floating slabs)

---

## 📄 License

Distributed under the [MIT License](LICENSE).
