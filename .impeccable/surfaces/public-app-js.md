---
version: 1
slug: "public-app-js"
primary_target: "public/app.js"
related_targets: ["public/index.html","public/styles.css"]
---

# Operations workspace

Mode: Operate. Scope: the whole signed-in workspace (shell, navigation, overview, request registers, request detail, records, inventory, reports, notifications, settings) plus sign-in. Users: managers triaging at a desk and technicians updating work on phones, equally; requesters submit and follow their own tickets. Constraints: plain browser JavaScript, locally bundled fonts, behavior and Playwright browser checks preserved, WCAG AA contrast, no browser dialogs.

User chose a replacement visual world (redesign), all four areas in scope: navigation, dashboard, request detail, tables and pages.

## Direction contract

THESIS: Every request is a numbered work ticket torn from one shared pad; the workspace is that pad, its rubber stamps and the office ledger. It refuses the generic SaaS card dashboard with pastel status pills.

OWN-WORLD: White bond ticket stock on a cool grey desk; canary and pink copy tints mark the second and third copies (assignee and office views). Carbon-blue numerals (#2f3a8f) carry ticket numbers and counts; vermilion stamp ink (#c8321f) marks urgent and overdue; black ruled hairlines form every field. States are rubber stamps with words, outlined, slightly rotated only in detail view; dashed outline means awaiting, struck means archived. Navigation is a column of pad tab dividers grouped Requests / Places / Stock / Reports / Admin.

STORY: Staff see today's ledger of tickets, spot stamped overdue and urgent work, open a ticket that reads like the paper form (header block, ruled fields, lifecycle strip, copies), stamp it forward, and file it. Records, stock and reports are ledgers in the same ruled grammar.

FIRST VIEWPORT: Tab-divider rail left (desk grey). Top: an "Open a ticket" pad action and a one-line count strip in carbon numerals (Open, Overdue stamped vermilion, In progress, Awaiting approval). Centre: the ledger, WO numbers large at left, title and place, stamp column, assignee, due. Mobile: tabs become a bottom bar of five groups; ledger rows become ticket stubs.

FORM: Work Ticket Pad, position 3 of 7 on the ordered list, seed key e663081f. Raises: line-form states (emission rail), focused row expands in place (streaming wall), fixed-scale lifecycle strip Open → In progress → On hold → Completed on every ticket (botanical folio), one visible ruled field grid (Crouwel grid), one numeral face at three fixed steps (Emigre bitmap). Signature interaction: stamping a ticket forward (status change animates a stamp landing on the lifecycle strip). Motion grammar: short, mechanical, stamp-press 160ms; reduced motion disables.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
