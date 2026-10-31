import type { QuestState } from "@t3tools/contracts";

export const questSeed: QuestState = {
  revision: 0,
  work: [
    {
      id: "market",
      parentId: null,
      title: "Market tracking · historical snapshot",
      state: "active",
      owner: "Human Quest owner",
      agent: "Unassigned",
      understanding:
        "Retained example only. Milestone A is recorded active; this prototype does not resume its workers.",
      documentIds: ["living-brief", "source-index", "source-queue"],
      priorAttempts: "",
      findings: "",
      handoff: "",
    },
    {
      id: "milestone-a",
      parentId: "market",
      title: "Milestone A · visible corpus and useful next work",
      state: "active",
      owner: "Human Quest owner",
      agent: "Unassigned",
      understanding:
        "Recorded in execution since 30 October. Contracts reviewed/fixed; ranking, finite plans, issue register, navigation and calibration are named work. No agent is running from this view.",
      documentIds: ["source-index", "living-brief"],
      priorAttempts: "",
      findings: "",
      handoff: "",
    },
    {
      id: "summary-gap",
      parentId: "milestone-a",
      title: "Reconcile the conflicting queue summaries",
      state: "attention",
      owner: "Human Quest owner",
      agent: "Unassigned",
      understanding:
        "Prototype proposal: decide how this example should communicate the older planning summary beside the newer active-work account. No actual pending owner question was found in the source.",
      documentIds: ["source-index", "source-queue", "living-brief"],
      priorAttempts: "",
      findings: "",
      handoff: "",
    },
    {
      id: "review-deliveries",
      parentId: "market",
      title: "Nine older deliveries · awaiting review",
      state: "review",
      owner: "Human Quest owner",
      agent: "Unassigned",
      understanding:
        "The work index lists nine earlier deliveries with outstanding acceptance boundaries. They are not nine active implementation queues.",
      documentIds: ["source-index"],
      priorAttempts: "",
      findings: "",
      handoff: "",
    },
    {
      id: "deferred",
      parentId: "market",
      title: "Deferred evaluation and report obligations",
      state: "deferred",
      owner: "Human Quest owner",
      agent: "Unassigned",
      understanding:
        "M2-I3, M2-I4, M2-I5, full Trial A/B/C, report v1 and Restate adoption retain open limits and acceptance requirements.",
      documentIds: ["source-index", "source-attempt"],
      priorAttempts: "",
      findings: "",
      handoff: "",
    },
    {
      id: "retained-attempt",
      parentId: "deferred",
      title: "Prior paid-response recovery · recorded outcome",
      state: "done",
      owner: "Human Quest owner",
      agent: "Unassigned",
      understanding:
        "Historical case for preparing an analogous bounded handoff. Recovery was selected by the owner; do not present it as a fresh pending request.",
      documentIds: ["source-attempt"],
      priorAttempts:
        "A source-audit response succeeded with 11,762 input and 4,051 output tokens, then local adaptation failed. The owner selected recovery of the retained response. The recorded completed total is seven calls, 100,319 input and 22,761 output tokens.",
      findings:
        "Inspect retained response and the local adaptation boundary before considering another paid call. Recorded response success is distinct from local processing failure. Wider evaluation acceptance is not implied.",
      handoff:
        "Prototype proposal for future analogous work: inspect the retained response and prior local adaptation failure; verify source identities; adapt locally without a new provider call. Stop and ask the human owner if retained content is missing or new execution would be needed. This is a prepared handoff, not a dispatched task.",
    },
  ],
  documents: [
    {
      id: "source-index",
      title: "Captured work index · 30 October",
      body: "# Current work\n\nOpen the app at [market-tracking/dist/index.html](../../../market-tracking/dist/index.html). [parallel-delivery.md](parallel-delivery.md) owns the queue, shared store, budget and integration. Delivered work does not have to be accepted before the next already-authorized correction can proceed. Claude owns the audit/crawl changes, including any separately announced shared navigation edits. The coordinator owns catalogue/fleet selection and source controls; isolated verification avoids competing builds.\n\n## Active execution\n\n[Milestone A: Visible corpus and useful next work](visible-corpus-and-plan.md) is in execution since 30 October: A1 contracts (reviewed and fixed), A2 ranking, A3 finite plans (in review), A5a issue register, the adopted navigation redesign (N1a) and a subscription-usage calibration, followed by a small live A4 demonstration within the owner-approved envelope. That record holds the owner decisions, write ownership of active workers and the slice table. Shared-store mutation, live runs and the canonical dist stay with the milestone A coordinator. Claude's earlier Coverage work retains its record; its independent review now targets the migrated Coverage pages.\n\n## Domain queue after planning\n\n| Priority | Outcome | Current gap and next action |\n|---|---|---|\n| 1 | Trustworthy company and product identities | The 43 alias candidates and 31 generic originals now have refined dispositions: 34 supplier-label relations, five OEM relations, four unresolved aliases, and five generic originals without reliable primary product evidence. The selected directory has 871 entries; finish current-product and legal-company identity before claiming canonical counts. |\n| 2 | pulsatrix public/internal comparison | Delivered in Fleet analysis: 17 public statements and 12 internal code observations for pulsatrix smart, with Public/Internal/Both source selection. Eight public statements are in development. Per-generation exposure and deployed availability remain unverified; next deepen those boundaries and hardware datasheet profiles. |\n| 3 | Credible category coverage | OCA reconciliation adds 215 provisional CSMS designations; Directory now shows reference-list denominators. The German list check reuses the original seed and does not prove independent EVSE breadth. Next qualify DACH CSMS leads and reconcile independent EVSE and fleet rosters. Existing counts remain labels/leads. [Corpus establishment](corpus-establishment.md) owns the milestone. |\n| 4 | Close crawl/usage review | The Opus UI and shared projection are integrated. [Independent review](crawl-usage-ux.md) is still unrecorded; check the current selected build rather than reapplying the old patch. |\n| 5 | Targeted feature depth | Prioritize products with missing or portfolio-only assignments, blocked sources and comparison-critical cells. [Fleet products](fleet-products.md) and [EVSE products](evse-products.md) retain domain obligations. More rows alone do not fix uncertain identity. |\n\nThe queue above remains open; identity work there now runs through A5a's issue register rather than a separate queue.\n\nThe [catalogue audit](../evidence/catalogue-audit-2026-10-29/audit.md) and [public/internal delivery](../evidence/pulsatrix-comparison-2026-10-29/README.md) supersede the initial five-label repair. The full retained inventory was classified and the source toggle is implemented; the [roster pass](../evidence/roster-reconciliation-2026-10-29/README.md) adds bounded CSMS breadth, while independent EVSE/fleet discovery and exact current product identity remain open. No full-market census or deployed feature support is claimed.\n\n## Delivered, awaiting review\n\n[review/](review/) contains earlier deliveries and their outstanding acceptance boundaries: [AC comparison](review/ac-comparison-2026-10-29.md), [initial browser](review/first-product-browser.md), [fleet visualization bridge](review/fleet-data-bridge.md), [fleet breadth pass](review/fleet-matrix-2h.md), [gap actions](review/gap-planning.md), [redesign](review/redesign.md), [unattended browser](review/unattended-market-browser-2026-10-28.md), [exploration UX](review/ux-exploration.md) and [product UX](review/ux-products.md). They are not nine active implementation queues. The current CSMS comparison is recorded in [fleet-products.md](fleet-products.md).\n\n## Deferred obligations\n\n[followups/](followups/) holds [remaining crawl policy and pilot evidence](followups/crawl-strategy.md), [M2-I3 evaluation](followups/m2-i3.md), [M2-I4 interpretation](followups/m2-i4.md), [M2-I5 historical reconstruction](followups/m2-i5.md), [full Trial A/B/C](followups/targeted-extraction.md), [report v1](followups/report-v1.md) and [Restate adoption](followups/restate-runner-prototype.md). Their limits and acceptance requirements remain open; a useful browser does not close them.\n\n## Retired records\n\nAlready accepted or explicitly stopped records moved to [the archive](../../archive/market-tracking/work/): [calibration](../../archive/market-tracking/work/corpus-calibration-handoff.md), [quality](../../archive/market-tracking/work/corpus-quality.md), [F1–F5](../../archive/market-tracking/work/corpus-format-handoff.md), [M2-I1](../../archive/market-tracking/work/m2-i1.md), [M2-I2](../../archive/market-tracking/work/m2-i2.md), [import/pilot](../../archive/market-tracking/work/import-and-pilot.md), [first scan/browser plan](../../archive/market-tracking/work/first-scan-and-browser.md), [scan preparation](../../archive/market-tracking/work/scan-preparation.md), [first supplier batch](../../archive/market-tracking/work/first-supplier-batch.md) and [scan expansion](../../archive/market-tracking/work/scan-expansion.md). Only those recorded scopes are retired; deferred criteria remain in the current obligations above. No new acceptance was inferred. Earlier source and delivery snapshots remain unchanged; Markdown links were repaired for the moves.\n\nHistorical path strings in hash-pinned policies, rules, definitions and input snapshots remain unchanged. Resolve them through the [relocation map](../evidence/catalogue-identity-2026-10-29/work-moves.json); changing those strings would change the recorded identity of a policy or run input. Current Markdown links, code comments and unpinned config references use the new locations.\n",
      kind: "evidence",
      source:
        "work/README.md · retained capture 2026-10-31 · full captured document · original SHA-256 3ae8be37374b14d3c99c195a6aaa6386bf8ef6acebbe003a76a30c9298d91e88",
      sha256: "3ae8be37374b14d3c99c195a6aaa6386bf8ef6acebbe003a76a30c9298d91e88",
    },
    {
      id: "source-queue",
      title: "Captured queue · conflicting planning summary",
      body: "# Parallel product research and browser delivery\n\nOn 29 October the owner asked to clean up the existing packages and prepare parallel EVSE, fleet-product, UX and fleet-data integration work. The owner clarified “I want a full feature map” for fleet and authorized sorting the uncommitted files into maintained assets and ignored one-offs. This record owns the subsequently authorized build and its first-wave limits. Package creation alone supplied no execution authority. Earlier delivered work remains available for owner review; cleanup does not imply acceptance of unmet milestones.\n\n## Current queue, 29 October 2026\n\nThe current ordered queue is [work/README](README.md). The owner has selected [milestone A planning](visible-corpus-and-plan.md), including independent Astra designs and document consolidation, with no implementation. That record owns A's proposed ranking, plan bridge, slices and acceptance criteria. It does not start another acquisition or model campaign. Claude's ongoing Coverage/UI work retains its separate scope and must be reconciled before any later A code edits.\n\nThe [identity correction](../evidence/catalogue-identity-2026-10-29/README.md), [full catalogue audit](../evidence/catalogue-audit-2026-10-29/audit.md), [pulsatrix comparison](../evidence/pulsatrix-comparison-2026-10-29/README.md) and [roster reconciliation](../evidence/roster-reconciliation-2026-10-29/README.md) are retained delivery checkpoints. Domain population, exact identities and feature-depth obligations remain in the work index. The original first-wave plan below preserves its bounds and evidence; it is not six current worker assignments or a fresh spending allowance.\n\n## Original first-wave outcomes\n\n| Track | Deliverable | Start dependency |\n|---|---|---|\n| [EVSE products](evse-products.md) | Repeatable common-field preparation, another 10–15 comparable profiles, and a gap inventory for all 54 current profiles | Existing pinned AC delivery; shared mapping seam check |\n| [Fleet products and full feature map](fleet-products.md) | A broad feature catalogue and evidence-backed product matrix, including non-charging fleet functions | Seed inventory can start immediately; first durable mappings need catalogue identity agreement |\n| [Product and comparison UX](review/ux-products.md) | Readable product, configuration, price and comparison journeys on real populated data | Current projection v8 |\n| [Exploration and market UX](review/ux-exploration.md) | Candidate-first exploration, useful population/coverage views and clearly explained next actions | Current projection v8; live action-result display waits for planning contract |\n| [Fleet data bridge](review/fleet-data-bridge.md) | The fleet feature tool consumes a pinned shared-data export with lossless evidence/status semantics | Adapter fixtures can start immediately; real export depends on fleet selection |\n| [Gap planning and execution](review/gap-planning.md) | A selected gap plan runs through the CLI and returns visible results | Agreed small gap/action result contract; real gap selection from product tracks |\n\nThe catalogue is intended to cover the full feature space, but discovery is not yet saturated; the first product sample is bounded. Neither eight fleet products nor 54 EVSE profiles establishes full-market coverage. Fleet mapping must include ordinary FMS capabilities even when a vendor has no disclosed charging capability.\n\n## Parallel and sequential boundaries\n\n```mermaid\nflowchart TD\n    S[Shared boundary checkpoint] --> E[EVSE products]\n    S --> F[Fleet catalogue and products]\n    S --> U[Product and comparison UX]\n    S --> X[Exploration and market UX]\n    S --> B[Fleet adapter fixtures]\n    S --> G[Gap planner and CLI]\n    F --> R[Pinned fleet export]",
      kind: "evidence",
      source:
        "work/parallel-delivery.md · retained capture 2026-10-31 · lines 11-44 · original SHA-256 64c563647c32b64861c041dfef80b409127dcf3185ce449e932ab7879675eca5",
      sha256: "0af4ffbdd26438e42a3fdd63488473b4e9583fd61af56981949d4602bf3c0727",
    },
    {
      id: "source-attempt",
      title: "Captured paid response and recovery record",
      body: "### Accepted execution and corpus results, 2026-10-28\n\nThe owner accepted the runner and selected execution. C05–C07 are imported and normalized in run 4, pinned cumulatively as snapshot 8. KEBA DCW15 and ChargePoint Trust Center captured and normalized in run 5 under one separately capped browser batch, pinned cumulatively as snapshot 9; the company target remains deferred. See [onboarding](../../evidence/i3-onboarding-2026-10-28.md) and [browser batch](../../evidence/i3-browser-batch1-2026-10-28.md). These are acquired candidates, not a frozen untouched evaluation sample.\n\nThe first real source-only audit used 11,762 input and 4,051 output tokens, then local adaptation refused one ambiguous short quote. The owner selected “Recover the saved audit and continue; no replacement audit call”. The [I2 record](../../../archive/market-tracking/work/m2-i2.md#stage-0-observation-and-selected-recovery) owns zero-call derivation, exact-delta review and continuation under the original accounting scope. No result or original failed attempt may be overwritten; the original charge remains included.\n\n\nCompleted stage 0: [measurement](../../evidence/i3-stage0-measurement-2026-10-28.md), [usage refit](../../evidence/i3-usage-estimate-2026-10-28.md). Seven calls used 100,319 input and 22,761 output tokens with no repeated paid response and no outstanding/unknown accounting. Blind fidelity: eleven accepted, one unresolved; primed: ten accepted, two unresolved. Exact audit matching remains unresolved for eight eligible units per arm; four additional units are selection/context gaps. No winning-arm, recall or untouched-generalisation claim is established. Wider I3 limits remain unselected. Reduced B2 is accepted in [I2](../../../archive/market-tracking/work/m2-i2.md#owner-acceptance-of-reduced-b2-2026-10-28).",
      kind: "evidence",
      source:
        "work/followups/m2-i3.md · retained capture 2026-10-31 · lines 300-307 · original SHA-256 17e7db0c398b0ef16b08e898e59bcd7df5aada4313e2580e06a5af9e02f3a1ec",
      sha256: "c3596b7cfb2db0266ce6cc95d89b4c3224164fa6668958fcda0dab3d3bc36a4c",
    },
    {
      id: "living-brief",
      title: "Current understanding · prototype working note",
      body: "Historical example, reconstructed from the retained snapshot. The work index names Milestone A as active since 30 October, while the queue summary still says planning. Treat the work index as the more recent account, with the discrepancy retained for review. Nine older deliveries await review; they are not nine active queues.\n\nThis editable note belongs to the prototype. No original queue or execution authority changes when it is saved.",
      kind: "living",
      source: "Prototype synthesis · not a captured source",
      sha256: "",
    },
  ],
  questions: [
    {
      id: "summary-question",
      workId: "summary-gap",
      title: "How should the conflicting summaries appear?",
      context:
        "Prototype proposal reconstructed from the source discrepancy. The newer work index says active since 30 October; the captured queue still says planning. The choice only updates this example after explicit application.",
      alternatives: [
        "Use the newer work index as current understanding and retain the older summary as evidence.",
        "Keep both accounts unresolved until the human owner reviews them.",
      ],
      answer: null,
      deferred: false,
      applied: false,
      proposal: true,
    },
  ],
};
