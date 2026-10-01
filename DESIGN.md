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
  numeral:
    fontFamily: "Archivo, Segoe UI, system-ui, sans-serif"
    fontSize: "32px"
    fontWeight: 800
    lineHeight: 1
    fontVariation: "'wdth' 74"
    fontFeature: "'tnum'"
  ticket-number:
    fontFamily: "Archivo, Segoe UI, system-ui, sans-serif"
    fontSize: "17px"
    fontWeight: 750
    lineHeight: 1.2
    letterSpacing: "0.02em"
    fontVariation: "'wdth' 74"
    fontFeature: "'tnum'"
  headline:
    fontFamily: "Archivo, Segoe UI, system-ui, sans-serif"
    fontSize: "19px"
    fontWeight: 750
    lineHeight: 1.25
  title:
    fontFamily: "Archivo, Segoe UI, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 650
    lineHeight: 1.35
  body:
    fontFamily: "Archivo, Segoe UI, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.6
    fontFeature: "'tnum'"
  label:
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
  button:
    fontFamily: "Archivo, Segoe UI, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 650
    fontVariation: "'wdth' 88"
rounded:
  stamp: "2px"
  sheet: "3px"
  tab: "5px 9px 0 0"
  round: "50%"
spacing:
  xs: "4px"
  sm: "8px"
  md: "14px"
  lg: "22px"
  xl: "26px"
  gutter: "36px"
components:
  button-primary:
    backgroundColor: "{colors.carbon}"
    textColor: "{colors.paper}"
    typography: "{typography.button}"
    rounded: "{rounded.sheet}"
    padding: "10px 16px"
  button-primary-hover:
    backgroundColor: "{colors.carbon-deep}"
    textColor: "{colors.paper}"
  button-secondary:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sheet}"
    padding: "8px 12px"
  button-secondary-hover:
    backgroundColor: "{colors.carbon-wash}"
    textColor: "{colors.ink}"
  button-danger:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.stamp}"
    rounded: "{rounded.sheet}"
    padding: "8px 12px"
  button-danger-armed:
    backgroundColor: "{colors.stamp}"
    textColor: "{colors.paper}"
  stamp-button:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.carbon}"
    typography: "{typography.stamp}"
    rounded: "{rounded.sheet}"
    padding: "8px 12px 7px"
  stamp-button-next:
    backgroundColor: "{colors.carbon}"
    textColor: "{colors.paper}"
    typography: "{typography.stamp}"
    rounded: "{rounded.sheet}"
    padding: "8px 12px 7px"
  filter-tab:
    backgroundColor: "transparent"
    textColor: "{colors.ink-2}"
    typography: "{typography.label}"
    rounded: "{rounded.sheet}"
    padding: "6px 10px 5px"
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
  field-cell:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink-3}"
    typography: "{typography.label}"
    padding: "8px 10px 6px"
  field-cell-focus:
    backgroundColor: "{colors.carbon-wash}"
    textColor: "{colors.ink}"
  nav-tab-divider:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink-2}"
    typography: "{typography.label}"
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

**Key Characteristics:**
- Archivo variable, used at two widths: condensed caps (74%) for label stock, stamps and numerals, and normal width for reading text.
- Tabular numerals everywhere; carbon blue is the numeral and action ink.
- Ruled grids whose cells share single hairlines; a 2px ink rule caps every register.
- Rubber-stamp states: outlined condensed caps with the state word always present.
- Flat paper on a grey desk; shadows only on things lifted off the pad.

## Colors

A grey desk, white bond paper and black ink, with carbon blue as the one working colour and vermilion stamp ink as the alarm.

### Primary
- **Carbon Blue** (carbon): ticket numbers, tally and metric numerals, links, primary and stamp buttons, focus rings, toggles, carets and the active nav icon. It is the colour of the pad's carbon copy.
- **Deep Carbon** (carbon-deep): hover and pressed state of every carbon-filled control and link.
- **Carbon Wash** (carbon-wash): row hover, focused field cells, unread inbox rows and secondary button hover. It is a faint carbon transfer on paper.

### Secondary
- **Vermilion Stamp Ink** (stamp): urgent priority (filled stamp), high priority (outlined), overdue dates and the Overdue mark, destructive buttons and their armed state, unread count badges and form errors.
- **Stamp Wash** (stamp-wash): hover ground of the destructive secondary button only.

### Tertiary
- **Canary Copy** (canary) and **Pink Copy** (pink): the second (assignee) and third (office) copies of the ticket. They appear only in the stacked copy glyph and as a 22% tint of the sheet head.
- **Ochre Hold** (hold) and **Ledger Green** (done): On hold and Completed in status and lifecycle stamps, and Awaiting approval and Approved on reservation stamps.

### Neutral
- **Cool Desk** (desk): the page ground and active nav tab, plus the completed cells of the lifecycle strip.
- **Rail Grey** (rail): the tab-divider rail and unselected settings tabs.
- **Bond White** (paper): every ticket, register, field and sheet surface.
- **Ink** (ink): headings, body values, ruled field grids, register top rules and the selected filter tab fill.
- **Ink 2 / Ink 3** (ink-2, ink-3): secondary text, then labels, metadata and placeholders.
- **Rule / Strong Rule / Row Rule** (rule, rule-strong, row): structural hairlines, form-field rules and dashed outlines, and the faint dividers between ledger rows.

### Named Rules
**The Carbon Numeral Rule.** Numbers that identify or count (WO numbers, tallies, metrics, register figures, nav counts) are condensed carbon. Carbon is also the only action colour; no second accent exists.

**The Stamp Ink Rule.** Vermilion means urgent, late, destructive or needs-attention. It is never decoration, never a heading colour and never a background larger than a stamp or badge.

**The Carbon Copy Rule.** Canary and pink exist only as copies of the ticket: the copy glyph and the sheet-head tint. They are never fills, highlights or status colours.

**The Words-On-Stamps Rule.** Green and ochre appear only inside stamps that also print the state word (Completed, On hold, Approved, Awaiting approval). Colour never carries state alone.

## Typography

**Display Font:** Archivo (variable width 62–125%, self-hosted; fallback Segoe UI, system-ui, sans-serif)
**Body Font:** Archivo at 100% width
**Label Font:** Archivo at 74% width, uppercase

**Character:** A single grotesque that changes width the way a ticket form does. Condensed caps are the printed label stock of the pad, and normal width is the handwriting filled into it. Tabular figures are set globally on the root.

### Hierarchy
- **Display** (800, 38px, line-height 1, condensed, uppercase, 30px on phones): page titles such as TODAY, and the login ticket title at 34px.
- **Numeral** (800, 32px, condensed, carbon; 26px on phones): the tally line and report metrics. Register figures use 20px of the same voice.
- **Ticket number** (750, 17px in the ledger, 22px in the sheet head, condensed, carbon): WO numbers.
- **Headline** (750, 19px, line-height 1.25): the sheet title. Section heads use 18px at 750.
- **Title** (650, 14px, line-height 1.35): ledger request titles and register row names.
- **Body** (400, 14px, line-height 1.6, max 68ch): paragraphs. Ledger cells and secondary text run at 13px, metadata at 12px.
- **Label** (750, 11–12px, 0.06em, condensed uppercase): nav tab dividers, table headers, register titles, filter tabs, copy labels and lifecycle labels. Field-cell labels are 10.5px at 700.
- **Stamp** (800, 11px, 0.07em, condensed uppercase): status and priority stamps. Lifecycle stamps are 15px at 850 with 0.08em tracking.

### Named Rules
**The Label Stock Rule.** Condensed uppercase is reserved for printed form furniture: labels, tabs, headers, stamps and numerals. Anything a person types or reads as prose returns to 100% width, sentence case and zero tracking, including inputs inside condensed field cells.

## Layout

The desktop shell is a 252px tab-divider rail plus a fluid desk. Content sits in a 1480px max container with 28px/36px/64px padding (top, sides, bottom) and a 58px topbar ruled at the bottom. Today is a two-column grid with the ledger fluid and the side registers at 340px, separated by a 26px gap. The rhythm runs 4, 8, 14, 22, 26 and 36px. Rows pad 11–12px by 14–16px. Section heads sit 30px above their register.

At 1180px and below, the side registers drop under the ledger in an auto-fit grid (minimum 280px), and padding tightens to 24px. At 760px and below, the rail becomes a full-height sheet behind Menu. A 64px dock (Today, Requests, + New, Inbox, Menu) is fixed to the bottom with an ink top rule. Tally and metric lines become two-column ruled grids. Ledger rows become ticket stubs (number, stamp and due on the first line, request below, assignee and priority last). Every other register stacks into labelled rows with condensed caps labels drawn from the column names. Field grids drop to two columns on the ticket and one column in forms.

### Named Rules
**The Closed Frame Rule.** A ruled grid draws its frame on the right and bottom, and every cell draws its own left and top. Lines never double, and any cell count closes cleanly.

## Elevation & Depth

The pad is flat. Registers, ledgers and fields sit on the desk with hairline rules, and a 2px ink rule across the top of each register gives the weight that a shadow would give elsewhere. Hierarchy comes from ink weight and paper-against-desk contrast. Shadows appear only on objects lifted off the pad: the ticket sheet sliding in from the right, the login ticket and the toast.

### Shadow Vocabulary
- **Sheet** (`box-shadow: -18px 0 60px rgb(20 24 32 / 0.2), -2px 0 6px rgb(20 24 32 / 0.08)`): the right-hand ticket sheet over a 38% ink backdrop.
- **Lifted ticket** (`box-shadow: 0 24px 60px -24px rgb(20 24 32 / 0.35)`): the blank login ticket.
- **Toast** (`box-shadow: 0 10px 30px -8px rgb(20 24 32 / 0.45)`): the ink toast at the bottom centre.

### Named Rules
**The Flat Pad Rule.** Nothing resting on the desk casts a shadow. If it is not sliding over the pad, use a rule instead.

## Shapes

Paper corners are nearly square: 2px on stamps and ruled strips, 3px on buttons, fields, registers and sheets. Registers round only their bottom corners because the ink top rule runs flat. The one soft silhouette is the paper tab divider (5px 9px 0 0, open at the bottom), used for the nav group tabs and the settings index tabs. Avatars are the only circles. Dashed outlines mean provisional or awaiting: notices, the login foot, reservations, file placeholders, empty-state rings and the Awaiting approval stamp. Strike-through means filed away: archived, declined and cancelled stamps, and completed lifecycle labels.

## Components

### Buttons
Stamp-weight and businesslike; carbon is the only filled button colour.
- **Shape:** paper corner (3px).
- **Primary:** carbon fill, white text, 10px 16px, 650 weight at 88% width; deepens to carbon-deep on hover (0.14s ease-out).
- **Secondary:** paper with a strong-rule border, 8px 12px; hover gives a carbon wash and an ink border.
- **Danger:** a secondary button in stamp ink with a 55% stamp border. It arms to a solid vermilion fill on its confirming press.
- **Quiet:** a borderless carbon text action at 13px that underlines on hover.
- **Focus:** a 2px carbon outline offset 3px on every interactive element.

### Stamp Buttons (signature)
Lifecycle moves are stamped, not toggled. Condensed caps (13px, 800, 0.07em) sit inside a 2px carbon outline on paper. Hover tilts the button -2deg on a carbon wash and press tilts it -4deg at 0.97 scale. The next stage is filled carbon. Stamp buttons are always carbon, whatever state they apply. On phones they stack full-width.

### Status Stamps
- **Style:** condensed caps in a 1.5px currentColor outline with a 2px corner and no fill. Open is ink, In progress carbon, On hold ochre and Completed green.
- **Priority:** Urgent is a filled vermilion stamp and High is outlined vermilion. Normal and Low drop the outline and print in ink-3.
- **Variants:** dashed outline means awaiting. Strike-through on a strong-rule outline means archived, declined or cancelled.
- **Rotation:** list stamps sit upright. The Overdue mark (10.5px, -2deg in the ledger, -3deg on the tally) and the lifecycle stamp (-5deg) are the rotated impressions.

### Lifecycle Strip (signature)
A four-cell ruled strip (Open → In progress → On hold → Completed) framed in ink. Past cells take the desk ground with struck labels. The current cell carries a rotated 15px stamp. When a stage is stamped, the stamp lands (0.3s, scale 1.7 → 1 from -14deg with a blur release), then the sheet files away (0.24s, translate 48px/18px and rotate 1.5deg while fading).

### Ruled Field Grid
Read-only ticket cells and editable form fields share one ruled grid under the Closed Frame Rule. Ticket cells rule in ink in three columns; form fields rule in strong-rule in two. Each cell holds a 10.5px condensed caps label above a 14px value. A focused field takes a carbon wash ground with a 2px inset carbon underline. Inputs are borderless inside the cell. Inline forms (part + quantity + action) keep the button as a square ruled cell.

### Registers and Ledger
- **Frame:** paper with a 1px rule border, a 2px ink top rule, and 0 0 3px 3px corners.
- **Header:** register titles are 12px condensed caps over a row rule. Table headers are 11px condensed caps over a 1px ink rule.
- **Rows:** separated by row rules, with a carbon wash on hover. The focused or hovered ledger row expands in place to show description and requester (0.22s), while its siblings recede to 55–60% opacity.
- **Filter tabs:** condensed caps text tabs. The selected tab is a solid ink fill with white text.
- **Tally line:** one ruled line (2px ink top, 1px ink bottom) of condensed caps labels beside 32px carbon numerals, with cells divided by rules.

### Ticket Sheet
A right-hand sheet, max 760px wide with an ink left edge, full screen on phones. It slides in over 0.24s (cubic-bezier(0.16, 1, 0.3, 1)). The head is ruled in ink and carries the large WO number behind a rule divider, the title, the copy glyph with its label, and the close button. The copy glyph is three stacked 20×14 paper slips in white, canary and pink, with the viewer's copy brought to the front. The head takes a 22% canary or pink tint for the assignee or office copy. Back-of-ticket sections (attachments, parts, conversation, history) use condensed caps heads that run into an ink rule.

### Navigation
The rail is a column of pad tab dividers. Each group (Requests, Places, Stock, Office) is labelled by a paper tab (11px condensed caps, open-bottom tab corner) above ruled rows of 17px icon and label. The active row takes the desk ground, bridges into the content and turns its icon carbon. Counts are condensed carbon. On phones the dock uses condensed caps labels; the active item gets a 3px inset carbon top rule and + New is a carbon-filled cell. Inbox and the topbar bell carry vermilion count badges.

### Notices and Settings
Notices are paper with a dashed strong-rule outline at 13px ink-2, never tinted banners. Settings and notifications use index tabs over a white sheet with an ink border. The selected tab is paper with an ink outline that joins the sheet. Toggles are square-cornered tracks that fill carbon when on.

## Do's and Don'ts

### Do:
- **Do** set every ticket number and count in condensed carbon with tabular figures.
- **Do** print the state word inside every status stamp; outline by default, fill only Urgent.
- **Do** build fields, ticket cells and strips as ruled grids under the Closed Frame Rule.
- **Do** cap each register with a 2px ink top rule on paper against the desk.
- **Do** use dashed rules for awaiting and provisional, and strike-through for archived or filed.
- **Do** reserve canary and pink for the copy glyph and the sheet-head tint.
- **Do** honour reduced motion: every transition and animation, including the stamp landing and sheet filing, is disabled.

### Don't:
- **Don't** build card dashboards or tinted pastel status pills; this pad refuses them.
- **Don't** use vermilion for anything that is not urgent, late, destructive or an unread count.
- **Don't** use green or ochre outside state stamps, or let colour carry a state without its word.
- **Don't** fill stamp buttons in any colour other than carbon.
- **Don't** add shadows to registers, panels or rows; only the sheet, login ticket and toast are lifted.
- **Don't** set typed values or prose in condensed caps.
