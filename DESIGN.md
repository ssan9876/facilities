---
name: Facilities
description: A shared work-ticket pad for one organization's buildings, with its rubber stamps and office ledger.
colors:
  desk: "#e7e9ec"
  rail: "#dcdfe4"
  paper: "#ffffff"
  ink: "#1c1f24"
  ink-2: "#444a54"
  ink-3: "#5a606b"
  rule: "#c3c8cf"
  rule-strong: "#8b929c"
  row: "#e3e6ea"
  carbon: "#2f3a8f"
  carbon-deep: "#222b72"
  carbon-wash: "#eceefa"
  selection: "#c9cff5"
  stamp: "#c4301d"
  stamp-wash: "#fcebe7"
  canary: "#f3e27c"
  pink: "#f4bccb"
  hold: "#865d00"
  done: "#1d6a44"
typography:
  display:
    fontFamily: "Archivo, Segoe UI, system-ui, sans-serif"
    fontSize: "38px"
    fontWeight: 800
    lineHeight: 1
    letterSpacing: "0.01em"
    fontVariation: "'wdth' 74"
  display-login:
    fontFamily: "Archivo, Segoe UI, system-ui, sans-serif"
    fontSize: "34px"
    fontWeight: 800
    lineHeight: 1
    fontVariation: "'wdth' 74"
  display-phone:
    fontFamily: "Archivo, Segoe UI, system-ui, sans-serif"
    fontSize: "30px"
    fontWeight: 800
    lineHeight: 1
    fontVariation: "'wdth' 74"
  numeral:
    fontFamily: "Archivo, Segoe UI, system-ui, sans-serif"
    fontSize: "32px"
    fontWeight: 800
    lineHeight: 1
    fontVariation: "'wdth' 74"
    fontFeature: "'tnum'"
  numeral-phone:
    fontFamily: "Archivo, Segoe UI, system-ui, sans-serif"
    fontSize: "26px"
    fontWeight: 800
    lineHeight: 1
    fontVariation: "'wdth' 74"
    fontFeature: "'tnum'"
  ticket-title:
    fontFamily: "Archivo, Segoe UI, system-ui, sans-serif"
    fontSize: "24px"
    fontWeight: 750
    lineHeight: 1.2
  ticket-number-sheet:
    fontFamily: "Archivo, Segoe UI, system-ui, sans-serif"
    fontSize: "22px"
    fontWeight: 750
    lineHeight: 1.1
    letterSpacing: "0.02em"
    fontVariation: "'wdth' 74"
    fontFeature: "'tnum'"
  brand:
    fontFamily: "Archivo, Segoe UI, system-ui, sans-serif"
    fontSize: "21px"
    fontWeight: 800
    lineHeight: 1
    letterSpacing: "0.03em"
    fontVariation: "'wdth' 74"
  figure:
    fontFamily: "Archivo, Segoe UI, system-ui, sans-serif"
    fontSize: "20px"
    fontWeight: 800
    lineHeight: 1
    fontVariation: "'wdth' 74"
    fontFeature: "'tnum'"
  headline:
    fontFamily: "Archivo, Segoe UI, system-ui, sans-serif"
    fontSize: "19px"
    fontWeight: 750
    lineHeight: 1.25
  section:
    fontFamily: "Archivo, Segoe UI, system-ui, sans-serif"
    fontSize: "18px"
    fontWeight: 750
    lineHeight: 1.25
  ticket-number:
    fontFamily: "Archivo, Segoe UI, system-ui, sans-serif"
    fontSize: "17px"
    fontWeight: 750
    lineHeight: 1.2
    letterSpacing: "0.02em"
    fontVariation: "'wdth' 74"
    fontFeature: "'tnum'"
  control-touch:
    fontFamily: "Archivo, Segoe UI, system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 400
  title:
    fontFamily: "Archivo, Segoe UI, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 650
    lineHeight: 1.35
  body:
    fontFamily: "Archivo, Segoe UI, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.6
    fontFeature: "'tnum'"
  control:
    fontFamily: "Archivo, Segoe UI, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 400
  button:
    fontFamily: "Archivo, Segoe UI, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 650
  field-label:
    fontFamily: "Archivo, Segoe UI, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 650
    letterSpacing: "0"
  cell:
    fontFamily: "Archivo, Segoe UI, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    fontFeature: "'tnum'"
  meta:
    fontFamily: "Archivo, Segoe UI, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.5
  caption:
    fontFamily: "Archivo, Segoe UI, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 400
  label:
    fontFamily: "Archivo, Segoe UI, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 750
    letterSpacing: "0.06em"
    fontVariation: "'wdth' 74"
  label-small:
    fontFamily: "Archivo, Segoe UI, system-ui, sans-serif"
    fontSize: "11px"
    fontWeight: 750
    letterSpacing: "0.06em"
    fontVariation: "'wdth' 74"
  stamp:
    fontFamily: "Archivo, Segoe UI, system-ui, sans-serif"
    fontSize: "11px"
    fontWeight: 800
    lineHeight: 1
    letterSpacing: "0.07em"
    fontVariation: "'wdth' 74"
rounded:
  slip: "1px"
  stamp: "2px"
  sheet: "3px"
  control: "4px"
  tab: "5px 9px 0 0"
  tab-near: "5px"
  scrollbar: "6px"
  badge: "9px"
  round: "50%"
spacing:
  xs: "4px"
  sm: "8px"
  ms: "12px"
  md: "14px"
  ml: "16px"
  lg: "22px"
  xl: "26px"
  gutter: "36px"
  control: "40px"
  field: "44px"
components:
  button-primary:
    backgroundColor: "{colors.carbon}"
    textColor: "{colors.paper}"
    typography: "{typography.button}"
    rounded: "{rounded.control}"
    padding: "0 18px"
    height: "{spacing.control}"
  button-primary-hover:
    backgroundColor: "{colors.carbon-deep}"
    textColor: "{colors.paper}"
  button-secondary:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    typography: "{typography.button}"
    rounded: "{rounded.control}"
    padding: "0 16px"
    height: "{spacing.control}"
  button-secondary-hover:
    backgroundColor: "{colors.carbon-wash}"
    textColor: "{colors.ink}"
  button-danger:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.stamp}"
    rounded: "{rounded.control}"
    padding: "0 16px"
    height: "{spacing.control}"
  button-danger-armed:
    backgroundColor: "{colors.stamp}"
    textColor: "{colors.paper}"
  button-quiet:
    backgroundColor: "transparent"
    textColor: "{colors.carbon}"
    padding: "6px 4px"
    height: "36px"
  row-action:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "0 12px"
    height: "36px"
  row-action-hover:
    backgroundColor: "{colors.carbon-wash}"
    textColor: "{colors.ink}"
  stamp-button:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.carbon}"
    typography: "{typography.stamp}"
    rounded: "{rounded.sheet}"
    padding: "0 16px"
    height: "{spacing.control}"
  stamp-button-next:
    backgroundColor: "{colors.carbon}"
    textColor: "{colors.paper}"
    typography: "{typography.stamp}"
    rounded: "{rounded.sheet}"
    padding: "0 16px"
    height: "{spacing.control}"
  filter-tab:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink-2}"
    rounded: "{rounded.control}"
    padding: "0 14px"
    height: "38px"
  filter-tab-selected:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
  status-stamp:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    typography: "{typography.stamp}"
    rounded: "{rounded.stamp}"
    padding: "4px 6px 3px"
  status-stamp-urgent:
    backgroundColor: "{colors.stamp}"
    textColor: "{colors.paper}"
  field-input:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    typography: "{typography.control}"
    rounded: "{rounded.control}"
    padding: "0 12px"
    height: "{spacing.field}"
  field-label:
    textColor: "{colors.ink}"
    typography: "{typography.field-label}"
  field-cell:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink-3}"
    typography: "{typography.label-small}"
    padding: "8px 10px 6px"
  ticket-controls:
    backgroundColor: "{colors.desk}"
    rounded: "{rounded.control}"
    padding: "14px 16px"
  bulk-bar:
    backgroundColor: "{colors.paper}"
    rounded: "{rounded.control}"
    padding: "12px 16px"
  settings-nav:
    backgroundColor: "{colors.paper}"
    rounded: "{rounded.control}"
    padding: "14px 10px"
    width: "220px"
  settings-nav-item-selected:
    backgroundColor: "{colors.carbon-wash}"
    textColor: "{colors.carbon-deep}"
    rounded: "{rounded.control}"
    height: "{spacing.control}"
  top-search:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    typography: "{typography.control}"
    rounded: "{rounded.control}"
    padding: "0 12px"
    height: "{spacing.control}"
  nav-tab-divider:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink-2}"
    typography: "{typography.label-small}"
    rounded: "{rounded.tab}"
    padding: "4px 12px 3px 10px"
  register-panel:
    backgroundColor: "{colors.paper}"
    rounded: "0 0 3px 3px"
  notice:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink-2}"
    rounded: "{rounded.sheet}"
    padding: "10px 14px"
  dock-new:
    backgroundColor: "{colors.carbon}"
    textColor: "{colors.paper}"
    height: "64px"
---

# Design System: Facilities

## Overview

**Creative North Star: "The Work Ticket Pad"**

Every request is a numbered work ticket torn from one shared pad. The workspace is that pad, its rubber stamps and the office ledger. White bond ticket stock lies on a cool grey desk. Black ruled hairlines form every field. Carbon-blue numerals carry ticket numbers and counts, and vermilion stamp ink marks what is urgent or late. States are rubber stamps with words, outlined, never tinted pills. Navigation is a column of paper tab dividers along the left edge of the pad.

The density is office-ledger dense. The Today view is one ruled tally line of carbon numerals, a ledger of open tickets by due date with WO numbers large at the left, and ruled side registers. A ticket opens as a right-hand sheet (full screen on phones) with a four-stage lifecycle strip, stamp-forward buttons and a ruled field grid. Its head is tinted canary or pink when the viewer holds the assignee or office copy. Phones get a dock and turn every register into stacked, labelled ruled rows.

The system refuses the generic SaaS card dashboard with pastel status pills. Depth comes from rules and paper, not floating cards.

The working surfaces (forms, filters, buttons and the controls a person operates all day) are sized for utility: a 15px base, controls at least 40px tall, fields 44px, plainly boxed inputs with sentence-case labels above, and a visible carbon focus ring. The pad's label stock, stamps and numerals stay condensed; the controls a person fills in do not.

**Key Characteristics:**
- Archivo variable, used at two widths: condensed caps (74%) for label stock, stamps and numerals, and normal width for reading text and every control.
- Tabular numerals everywhere; carbon blue is the numeral and action ink.
- Ruled grids whose cells share single hairlines; a 2px ink rule caps every register.
- Rubber-stamp states: outlined condensed caps with the state word always present.
- Flat paper on a grey desk; shadows only on things lifted off the pad.
- Utility sizing: 15px base, 40px controls, 44px fields, 4px control corners, 12px floor for reading text.

## Colors

A grey desk, white bond paper and black ink, with carbon blue as the one working colour and vermilion stamp ink as the alarm.

### Primary
- **Carbon Blue** (carbon): ticket numbers, tally and metric numerals, links, primary and stamp buttons, focus outlines and focused field borders, toggles, carets, checkboxes and the active nav icon. It is the colour of the pad's carbon copy.
- **Deep Carbon** (carbon-deep): hover and pressed state of every carbon-filled control and link, and the text of the selected settings section.
- **Carbon Wash** (carbon-wash): row hover, picked ledger rows, the selected settings section, unread inbox rows and secondary button and row-action hover. It is a faint carbon transfer on paper.
- **Carbon Selection** (selection): the text selection highlight.

### Secondary
- **Vermilion Stamp Ink** (stamp): urgent priority (filled stamp), high priority (outlined), overdue dates and the Overdue mark, destructive buttons and their armed state, unread count badges, invalid field borders and form errors.
- **Stamp Wash** (stamp-wash): hover ground of the destructive secondary button and the ground of the boxed form error.

### Tertiary
- **Canary Copy** (canary) and **Pink Copy** (pink): the second (assignee) and third (office) copies of the ticket. They appear only in the stacked copy glyph and as a 22% tint of the sheet head.
- **Ochre Hold** (hold) and **Ledger Green** (done): On hold and Completed in status and lifecycle stamps, and Awaiting approval and Approved on reservation stamps.

### Neutral
- **Cool Desk** (desk): the page ground, the active nav tab, the ticket controls panel and the completed cells of the lifecycle strip.
- **Rail Grey** (rail): the tab-divider rail.
- **Bond White** (paper): every ticket, register, field, control and sheet surface.
- **Ink** (ink): headings, body values, field labels, ruled field grids, register top rules and the selected filter tab fill.
- **Ink 2 / Ink 3** (ink-2, ink-3): secondary text and hovered field borders, then metadata, placeholders and condensed label stock.
- **Rule / Strong Rule / Row Rule** (rule, rule-strong, row): structural hairlines and unselected filter-tab borders, field and button borders and dashed outlines, and the faint dividers between ledger rows.

### Named Rules
**The Carbon Numeral Rule.** Numbers that identify or count (WO numbers, tallies, metrics, register figures, nav counts) are condensed carbon. Carbon is also the only action colour; no second accent exists.

**The Stamp Ink Rule.** Vermilion means urgent, late, destructive, invalid or needs-attention. It is never decoration, never a heading colour and never a background larger than a stamp, badge or form error.

**The Carbon Copy Rule.** Canary and pink exist only as copies of the ticket: the copy glyph and the sheet-head tint. They are never fills, highlights or status colours.

**The Words-On-Stamps Rule.** Green and ochre appear only inside stamps that also print the state word (Completed, On hold, Approved, Awaiting approval). Colour never carries state alone.

## Typography

**Display Font:** Archivo (variable width 62–125%, self-hosted; fallback Segoe UI, system-ui, sans-serif)
**Body Font:** Archivo at 100% width
**Label Font:** Archivo at 74% width, uppercase

**Character:** A single grotesque that changes width the way a ticket form does. Condensed caps are the printed label stock of the pad, and normal width is the handwriting filled into it. Tabular figures are set globally on the root, and the root size is 15px.

### Hierarchy
- **Display** (800, 38px, line-height 1, condensed, uppercase): page titles such as TODAY. Page titles drop to 30px on phones; the login ticket title is 34px and the plain login page title 30px.
- **Numeral** (800, 32px, condensed, carbon; 26px on phones): the tally line and report metrics. Register figures use 20px of the same voice.
- **Ticket number** (750, condensed, carbon): WO numbers at 17px in the ledger, 22px in the sheet head and 26px on the full-page ticket head.
- **Brand** (800, 21px, condensed caps, 0.03em): the organization name in the rail.
- **Headline** (750, 19px, line-height 1.25): the sheet title; the full-page ticket title is 24px. Section heads, sheet headings and the calendar month use 18px at 750.
- **Title** (650, 15px, line-height 1.35): ledger request titles and register row names; setting names are 16px.
- **Body** (400, 15px, line-height 1.6, max 68ch): the root size, paragraphs, inputs, selects and button labels. Phone inputs, selects and the topbar finder rise to 16px.
- **Field label** (650, 14px, sentence case, 100% width, zero tracking): every form, filter, admin and ticket-control label, set above its box.
- **Cell** (400, 14px): ledger cells, quiet buttons, filter tabs (600), inline checks, setting descriptions and form context.
- **Meta** (400, 13px, line-height 1.5): secondary text, notices, auto-save status lines.
- **Caption** (12px): metadata and keyboard hints.
- **Label** (750, 12px, 0.06em, condensed uppercase): table headers, register titles, tally labels and settings group titles. Nav tab dividers, copy labels and lifecycle labels use 11px; ruled ticket-cell labels and the Overdue mark are 10.5px at 700.
- **Stamp** (800, 11px, 0.07em, condensed uppercase): status and priority stamps. Stamp buttons are 13px, and lifecycle stamps are 15px at 850 with 0.08em tracking.

### Named Rules
**The Label Stock Rule.** Condensed uppercase is reserved for printed form furniture: column and register headers, nav tab dividers, stamps, read-only ticket-cell labels and numerals. Anything a person types, reads as prose or operates (field labels, filter tabs, buttons, inputs, settings sections) is 100% width, sentence case and zero tracking.

**The Twelve Floor Rule.** Reading text and controls never go below 12px; only condensed label stock and stamps sit at 10.5–11px.

## Layout

The desktop shell is a 252px tab-divider rail plus a fluid desk. Content sits in a 1480px max container with 28px/36px/64px padding (top, sides, bottom) and a 58px topbar ruled at the bottom, which carries the breadcrumb, the ticket finder and the date and bell. Today is a two-column grid with the ledger fluid and the side registers at 340px, separated by a 26px gap. The rhythm runs 4, 8, 12, 14, 16, 22, 26 and 36px. Table cells pad 14px by 16px, headers 12px 16px 10px. Section heads sit 30px above their register. Form grids are two columns with 16px row and 18px column gaps; control rows wrap with 12px by 16px gaps.

Settings is a two-column layout: a sticky 220px section nav beside the active sheet, with a 26px gap. At 960px and below the nav sits above the sheet and its groups flow into an auto-fit grid (minimum 160px).

At 1180px and below, the side registers drop under the ledger in an auto-fit grid (minimum 280px), and padding tightens to 24px. At 760px and below, the rail becomes a full-height sheet behind Menu. A 64px dock (Today, Requests, + New, Inbox, Menu) is fixed to the bottom with an ink top rule. Primary and secondary buttons and stamp buttons grow to the 44px field height, and inputs rise to 16px. Tally and metric lines become two-column ruled grids. Ledger rows become ticket stubs (number, stamp and due on the first line, request below, assignee and priority last), with the pick checkbox as a left column when selection is on. Every other register stacks into labelled rows with condensed caps labels drawn from the column names. Field grids drop to two columns on the ticket and one column in forms.

### Named Rules
**The Closed Frame Rule.** A ruled grid draws its frame on the right and bottom, and every cell draws its own left and top. Lines never double, and any cell count closes cleanly.

**The Hit Target Rule.** Every control is at least 40px tall (control), every field 44px (field); quiet text actions and row actions keep a 36px hit area, and a whole table cell is the target for a row checkbox.

## Elevation & Depth

The pad is flat. Registers, ledgers and fields sit on the desk with hairline rules, and a 2px ink rule across the top of each register gives the weight that a shadow would give elsewhere. Hierarchy comes from ink weight and paper-against-desk contrast. Shadows appear only on objects lifted off the pad: the ticket sheet sliding in from the right, the login ticket, the notification popover, the toast, and the bulk selection bar while it sticks over scrolling rows. Focus is shown with a carbon outline or, on boxed fields, a soft carbon ring.

### Shadow Vocabulary
- **Sheet** (`box-shadow: -18px 0 60px rgb(20 24 32 / 0.2), -2px 0 6px rgb(20 24 32 / 0.08)`): the right-hand ticket sheet over a 38% ink backdrop.
- **Lifted ticket** (`box-shadow: 0 24px 60px -24px rgb(20 24 32 / 0.35)`): the blank login ticket.
- **Popover** (`box-shadow: 0 18px 40px -12px rgb(20 24 32 / 0.35)`): the notification popover under the bell.
- **Toast** (`box-shadow: 0 10px 30px -8px rgb(20 24 32 / 0.45)`): the ink toast at the bottom centre.
- **Sticky bar** (`box-shadow: 0 6px 20px rgb(20 24 32 / 0.1)`): the bulk selection bar, sticky above the ledger.
- **Focus ring** (`box-shadow: 0 0 0 3px color-mix(in srgb, var(--carbon) 22%, transparent)`): focused boxed fields and selects, with a carbon border. Not an elevation.

### Named Rules
**The Flat Pad Rule.** Nothing resting on the desk casts a shadow. If it is not sliding or floating over the pad, use a rule instead.

## Shapes

Paper corners are nearly square: 2px on stamps and ruled strips, 3px on stamp buttons, registers, sheets and the popover. Working controls take a slightly softer 4px (control): buttons, boxed fields, filter tabs, the ticket finder, the ticket controls panel, the bulk bar and the settings nav. Registers round only their bottom corners because the ink top rule runs flat. The one soft silhouette is the paper tab divider (5px 9px 0 0, open at the bottom), used for the nav group tabs. Avatars are the only circles; filter counts are 18px pills (9px), copy-glyph slips are 1px, and the scrollbar thumb is 6px. Dashed outlines mean provisional or awaiting: notices, the login foot, reservations, file inputs, empty-state rings and the Awaiting approval stamp. Strike-through means filed away: archived, declined and cancelled stamps, and completed lifecycle labels.

## Components

### Buttons
Businesslike and roomy; carbon is the only filled button colour.
- **Shape:** control corner (4px), at least 40px tall, centred label at 15px.
- **Primary:** carbon fill, white text, 0 18px, 650 weight at 100% width; deepens to carbon-deep on hover (0.14s ease-out).
- **Secondary:** paper with a strong-rule border, 0 16px, 600 weight; hover gives a carbon wash and a carbon border.
- **Danger:** a secondary button in stamp ink with a 55% stamp border. It arms to a solid vermilion fill on its confirming press.
- **Quiet:** a borderless carbon text action at 14px/650, always underlined (35% carbon underline, 4px offset) with a 36px hit area; the underline goes full carbon on hover.
- **Row actions:** inside a ledger row, quiet actions become bordered buttons: strong-rule border, 4px corner, ink text, 0 12px, 6px apart; hover gives a carbon border and carbon wash.
- **Focus:** a 2px carbon outline offset 3px on every interactive element.

### Stamp Buttons (signature)
Lifecycle moves are stamped, not toggled. Condensed caps (13px, 800, 0.07em) sit inside a 2px carbon outline on paper, 40px tall (0 16px). Hover tilts the button -2deg on a carbon wash and press tilts it -4deg at 0.97 scale. The next stage is filled carbon. Stamp buttons are always carbon, whatever state they apply. On phones they stack full-width at 44px.

### Status Stamps
- **Style:** condensed caps in a 1.5px currentColor outline with a 2px corner and no fill. Open is ink, In progress carbon, On hold ochre and Completed green.
- **Priority:** Urgent is a filled vermilion stamp and High is outlined vermilion. Normal and Low drop the outline and print in ink-3.
- **Variants:** dashed outline means awaiting. Strike-through on a strong-rule outline means archived, declined or cancelled.
- **Rotation:** list stamps sit upright. The Overdue mark (10.5px, -2deg in the ledger, -3deg on the tally) and the lifecycle stamp (-5deg) are the rotated impressions.

### Lifecycle Strip (signature)
A four-cell ruled strip (Open → In progress → On hold → Completed) framed in ink. Past cells take the desk ground with struck labels. The current cell carries a rotated 15px stamp. When a stage is stamped, the stamp lands (0.3s, scale 1.7 → 1 from -14deg with a blur release), then the sheet files away (0.24s, translate 48px/18px and rotate 1.5deg while fading).

### Ticket Controls
Status, assignee and priority sit in one panel at the top of the ticket: desk ground, rule border, 4px corner, 14px 16px padding, wrapping with 12px by 16px gaps. Each control is a 14px/650 sentence-case label above a 44px boxed select (paper, strong-rule border, drawn chevron, 15px). Selects save on change; while saving they dim to 60% with a progress cursor, and a 13px ink-2 status line under the row reports the result.

### Inputs / Fields
Editable forms are boxed fields with the label above.
- **Label:** 14px/650 ink, sentence case, 6px above its box. Required fields say nothing; optional ones say so.
- **Box:** paper, 1px strong-rule border, 4px corner, 44px tall, 0 12px, 15px/400 ink. Hover darkens the border to ink-2.
- **Focus:** carbon border plus the soft carbon focus ring; no outline.
- **Invalid:** a stamp-ink border after interaction. Form errors are a boxed stamp-wash note with a 40% stamp border, 14px/550.
- **Variants:** selects use a drawn chevron and 36px right padding; textareas are 120px minimum with 10px 12px padding; file inputs are dashed boxes with a bordered 34px picker button. Checkboxes are 20px carbon on a 44px row (38px inline).
- **Layout:** form grids are two columns with 16px by 18px gaps; inline forms (part + quantity + action) align to the bottom with 12px gaps and a 44px button.

### Ruled Field Grid
Read-only ticket cells keep the pad's ruled grid under the Closed Frame Rule, ruled in ink in three columns. Each cell holds a 10.5px condensed caps label above a 14px value.

### Registers and Ledger
- **Frame:** paper with a 1px rule border, a 2px ink top rule, and 0 0 3px 3px corners.
- **Header:** register titles are 12px condensed caps over a row rule. Table headers are 12px condensed caps over a 1px ink rule.
- **Rows:** 14px cells padded 14px 16px, separated by row rules, with a carbon wash on hover. The focused or hovered ledger row expands in place to show description and requester (0.22s), while its siblings recede to 55–60% opacity.
- **Filter tabs:** a segmented row of separate boxed tabs, 4px apart: 38px tall, paper with a rule border, 4px corner, 0 14px, 14px/600 sentence case in ink-2. Hover gives the desk ground and a strong-rule border; the selected tab is a solid ink fill with white text. Two-way switches (Inbox / Preferences) use the same control.
- **Selection:** when bulk actions are allowed, a 48px pick column leads the ledger; the whole cell toggles a 20px carbon checkbox, and picked rows take a carbon wash.
- **Bulk bar:** once rows are picked, a sticky bar appears above the ledger: paper, 1px carbon border, 4px corner, 12px 16px padding, the sticky-bar shadow. It holds the 15px count, ticket-control selects (Set status, Assign to), a primary Apply button and a quiet Clear selection.
- **Tally line:** one ruled line (2px ink top, 1px ink bottom) of condensed caps labels beside 32px carbon numerals, with cells divided by rules.

### Ticket Sheet
A right-hand sheet, max 760px wide with an ink left edge, full screen on phones. It slides in over 0.24s (cubic-bezier(0.16, 1, 0.3, 1)). The head is ruled in ink and carries the large WO number behind a rule divider, the title, the copy glyph with its label, and the close button. The copy glyph is three stacked 20×14 paper slips in white, canary and pink, with the viewer's copy brought to the front. The head takes a 22% canary or pink tint for the assignee or office copy. Back-of-ticket sections (attachments, parts, conversation, history) use condensed caps heads that run into an ink rule.

### Navigation
The rail is a column of pad tab dividers. Each group (Requests, Places, Stock, Office) is labelled by a paper tab (11px condensed caps, open-bottom tab corner) above ruled rows of icon and 15px label, at least 42px tall. The active row takes the desk ground, bridges into the content and turns its icon carbon. Counts are condensed carbon. On phones the dock uses condensed caps labels; the active item gets a 3px inset carbon top rule and + New is a carbon-filled cell. Inbox and the topbar bell carry vermilion count badges.

### Ticket Finder
The topbar carries one search box (up to 380px, pushed right): a 40px boxed field with a search icon, 4px corner and 0 12px padding. A WO number opens that ticket; words search the register. A 12px keycap hint ("/", strong-rule border with a 2px bottom) shows the shortcut and hides at 960px and below; on phones the finder fills the bar at 16px.

### Notices and Settings
Notices are paper with a dashed strong-rule outline at 13px ink-2, never tinted banners. Settings sections are listed in a grouped side nav: a sticky paper panel (rule border, 4px corner, 14px 10px padding) with groups 18px apart, each titled in 12px condensed caps ink-3 above 40px section buttons (15px/560 ink-2, 4px corner). Hover gives the desk ground; the selected section takes a carbon wash, carbon-deep text and 700 weight. The active section renders in a white sheet with an ink border beside it. Toggles are square-cornered tracks that fill carbon when on.

### Administration ledgers and the role grid

People and Groups are ruled ledgers on a full-width settings sheet with a toolbar (heading left, primary action right) and a filter row (search plus selects, 40px, with sentence-case labels); rows open edit sheets rather than inline forms. Group membership lives in the group's sheet as a searchable checkbox list that saves immediately. Roles is a permission grid: capabilities as sticky row headers (label plus one-line description) grouped by area, roles as columns with person counts and a quiet Reset or Delete action, carbon checkboxes, and the administrator column locked. Requesters see a single ruled "Report a problem" panel above their ticket register. QR report labels print as dashed-edge cards, two per row, with the kind in label caps, the place name, and a carbon "Scan to report a problem" line.

Pad polish: ticket sheets carry a perforated left edge, the No. column of every request ledger is set off by a double margin rule, and phone ledger stubs are separated by dashed tear lines.

## Do's and Don'ts

### Do:
- **Do** set every ticket number and count in condensed carbon with tabular figures.
- **Do** print the state word inside every status stamp; outline by default, fill only Urgent.
- **Do** build read-only ticket cells and strips as ruled grids under the Closed Frame Rule.
- **Do** build editable fields as 44px boxed controls with a 14px/650 sentence-case label above.
- **Do** keep every control at least 40px tall and show focus with the carbon outline or focus ring.
- **Do** cap each register with a 2px ink top rule on paper against the desk.
- **Do** use dashed rules for awaiting and provisional, and strike-through for archived or filed.
- **Do** reserve canary and pink for the copy glyph and the sheet-head tint.
- **Do** honour reduced motion: every transition and animation, including the stamp landing and sheet filing, is disabled.

### Don't:
- **Don't** build card dashboards or tinted pastel status pills; this pad refuses them.
- **Don't** use vermilion for anything that is not urgent, late, destructive, invalid or an unread count.
- **Don't** use green or ochre outside state stamps, or let colour carry a state without its word.
- **Don't** fill stamp buttons in any colour other than carbon.
- **Don't** add shadows to registers, panels or rows; only the sheet, login ticket, popover, toast and sticky bulk bar are lifted.
- **Don't** set typed values, prose, field labels or filter tabs in condensed caps.
- **Don't** set reading text or control labels below 12px.
