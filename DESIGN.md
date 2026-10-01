---
name: Facilities
description: A civic operations register for one organization's facilities.
colors:
  green: "#245b45"
  green-hover: "#173e2f"
  ink: "#20352f"
  muted: "#5b7067"
  workspace: "#f5f7f5"
  paper: "#fff"
  sidebar: "#f0f4ef"
  line: "#dce5de"
  row-line: "#edf1ec"
  nav-active: "#dce9db"
  nav-active-ink: "#214a34"
  neutral-status: "#edf1ee"
  neutral-status-ink: "#516359"
  progress: "#eaf1f9"
  progress-ink: "#365d85"
  completed: "#e6f3e6"
  completed-ink: "#367249"
  hold: "#f6efd9"
  hold-ink: "#85632e"
  urgent: "#f9e9e2"
  urgent-ink: "#a6412a"
  high: "#faf1df"
  high-ink: "#935f22"
  overdue: "#a1442b"
  accent: "#e7f1e8"
  supporting-ink: "#607265"
  switch-off: "#9aaba0"
  type-icon: "#edf4e9"
  type-hover: "#f0f6ee"
  unread: "#f3f8ef"
  inbox-icon: "#e9f0e4"
  inbox-title: "#244c38"
  empty-icon: "#e9f1e5"
typography:
  headline:
    fontFamily: "Manrope, Segoe UI, sans-serif"
    fontSize: "30px"
    fontWeight: 750
    letterSpacing: "-.035em"
  headline-mobile:
    fontFamily: "Manrope, Segoe UI, sans-serif"
    fontSize: "24px"
    fontWeight: 750
    lineHeight: 1.3
    letterSpacing: "-.035em"
  title:
    fontFamily: "Manrope, Segoe UI, sans-serif"
    fontSize: "18px"
    fontWeight: 700
    letterSpacing: "-.02em"
  body:
    fontFamily: "Manrope, Segoe UI, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.65
  label:
    fontFamily: "Manrope, Segoe UI, sans-serif"
    fontSize: "12px"
    fontWeight: 650
  metric:
    fontFamily: "Manrope, Segoe UI, sans-serif"
    fontSize: "29px"
    fontWeight: 650
    letterSpacing: "-.02em"
  supporting:
    fontFamily: "Manrope, Segoe UI, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.6
  control:
    fontFamily: "Manrope, Segoe UI, sans-serif"
    fontSize: "13px"
    fontWeight: 600
  settings-title:
    fontFamily: "Manrope, Segoe UI, sans-serif"
    fontSize: "17px"
    fontWeight: 700
    letterSpacing: "-.02em"
  metadata:
    fontFamily: "Manrope, Segoe UI, sans-serif"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.5
  metric-mobile:
    fontFamily: "Manrope, Segoe UI, sans-serif"
    fontSize: "24px"
    fontWeight: 650
    letterSpacing: "-.02em"
rounded:
  tag: "4px"
  field: "5px"
  navigation: "6px"
  action: "7px"
  panel: "8px"
  dialog: "10px"
  switch: "15px"
spacing:
  compact: "8px"
  control: "12px"
  mobile-gutter: "16px"
  form-gap: "18px"
  panel: "22px"
  medium-gutter: "24px"
  desktop-gutter: "38px"
components:
  button-primary:
    backgroundColor: "{colors.green}"
    textColor: "{colors.paper}"
    rounded: "{rounded.action}"
    padding: "11px 18px"
  button-primary-hover:
    backgroundColor: "{colors.green-hover}"
  button-secondary:
    backgroundColor: "{colors.paper}"
    textColor: "#29483a"
    rounded: "{rounded.navigation}"
    padding: "9px 13px"
  field:
    backgroundColor: "{colors.paper}"
    textColor: "#273e31"
    rounded: "{rounded.field}"
    padding: "10px"
  navigation-active:
    backgroundColor: "{colors.nav-active}"
    textColor: "{colors.nav-active-ink}"
    rounded: "{rounded.navigation}"
    padding: "11px 12px"
  panel:
    backgroundColor: "{colors.paper}"
    rounded: "{rounded.panel}"
  tag-default:
    backgroundColor: "{colors.neutral-status}"
    textColor: "{colors.neutral-status-ink}"
    rounded: "{rounded.tag}"
    padding: "4px 8px"
  switch-off:
    backgroundColor: "{colors.switch-off}"
    rounded: "{rounded.switch}"
    width: "44px"
    height: "26px"
  switch-on:
    backgroundColor: "{colors.green}"
    rounded: "{rounded.switch}"
    width: "44px"
    height: "26px"
  settings-tab:
    textColor: "{colors.muted}"
    typography: "{typography.control}"
    padding: "0 0 13px"
  settings-tab-selected:
    textColor: "{colors.green}"
  type-summary:
    textColor: "{colors.green}"
    padding: "18px 21px"
  inbox-unread:
    backgroundColor: "{colors.unread}"
    padding: "22px 25px"
  mobile-menu:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.green}"
    rounded: "{rounded.navigation}"
    padding: "7px 10px"
  type-summary-mobile:
    textColor: "{colors.green}"
    padding: "12px 8px"
---

# Design System: Facilities

## Overview

**Creative North Star: "Civic operations records"**

A quiet green navigation rail frames white work sheets and aligned registers. The implemented interface favors readable records, modest corners, clear field labels, and restrained actions. This descriptive name comes from the direction contract; no approved image composition exists.

The locally bundled Manrope family connects page headings, table records, forms, and navigation. A single organization shares one visual workspace; different buildings and equipment use the same record language.

**Key Characteristics:**
- Green navigation and actions against pale green neutral surfaces.
- Dense aligned registers with explicit text status markers.
- Flat sheets, subtle borders, and soft corners.
- Visible mobile Menu disclosure and scrollable tables.

## Colors

The palette is green-led, with muted neutral surfaces and semantic color confined to work state and attention.

### Primary
- **Operations green** (`green`): primary actions, sign-in, links, and the brand mark. The darker hover token signals action feedback.
- **Selected navigation green** (`nav-active`, `nav-active-ink`): active destination, independent of work-order state.

### Secondary
- **Progress blue** (`progress`, `progress-ink`): in-progress status.
- **Completion green** (`completed`, `completed-ink`): completed status.
- **Hold amber** (`hold`, `hold-ink`): on-hold status.
- **Urgent rust** (`urgent`, `urgent-ink`): urgent priority; `overdue` is used for overdue dates and the attention metric.
- **High amber** (`high`, `high-ink`): high priority.

### Neutral
- **Record ink** (`ink`): default text.
- **Muted green gray** (`muted`): supporting copy and metadata.
- **Workspace wash** (`workspace`), **Navigation wash** (`sidebar`), and **White paper** (`paper`): separate surrounding workspace, navigation, and work sheets.
- **Sheet line** (`line`) and **Row line** (`row-line`): container separation and register rows.
- **Neutral status** (`neutral-status`, `neutral-status-ink`): open state and normal or low priority.
- **Control and inbox washes** (`accent`, `type-icon`, `type-hover`, `unread`, `inbox-icon`, `empty-icon`): notification hover, type icons and hover, unread rows, inbox icons, and empty-state icon surroundings respectively.
- **Supporting ink** (`supporting-ink`) and **Inbox title ink** (`inbox-title`): request metadata and actionable notification titles.
- **Switch off** (`switch-off`): unchecked settings switches; checked switches use operations green.

**The State Has Words Rule.** Color accompanies a written status or priority; the dot never replaces the label.

## Typography

**Body and heading font:** locally bundled Manrope, with Segoe UI and sans-serif fallbacks. There is no separate display family or hero type ramp.

### Hierarchy
- **Headline:** page headings; the mobile headline role replaces the desktop size at the mobile breakpoint.
- **Title:** section headings; nested panel headings use a smaller size (15px).
- **Body:** general copy; paragraphs use the frontmatter line height. Settings explanatory copy is limited to 70ch.
- **Label:** field labels, record text, and metadata use compact text. Work-order titles use a slightly larger size (13px).
- **Metric:** operational counts, with tabular numerals. Mobile metrics use the 24px mobile role and hide supporting copy.
- **Supporting:** settings descriptions and inbox messages (13px); settings descriptions use the supporting role's line height, while inbox messages inherit paragraph line height (1.65).
- **Control:** navigation and settings tabs (13px, 600); compact desktop navigation uses 12px. Expanded mobile destinations use 13px; the Menu control uses 12px.
- **Settings title:** sheet and empty-state headings (17px, 700); inbox section headings use 16px.
- **Metadata:** request secondary lines (12px, line height 1.5), with 12px table footers and request-type labels.

**The Register Numerals Rule.** Keep dates and counts aligned with tabular numerals in tables and metrics.

The request extension intentionally enlarges table headings and status tags to 11px, and request secondary lines and table footers to 12px. This supersedes the original 10px heading/tag and 11px secondary/footer styling. Earlier compact choices still persist in organization and metric metadata (11px) and comment timestamps (10px); they remain implementation details pending legibility review rather than a general scale for new surfaces.

## Layout

The desktop shell reserves a fixed sidebar (236px) and places the workspace in the second column. The top bar is 77px high. Content has a 1510px maximum width and desktop padding of 36px 38px 50px. Summary metrics share one divided sheet; lower summary sections form a 1.3fr / 1fr grid with a 26px gap.

At widths up to 1100px, the sidebar becomes 210px, content uses 28px 24px padding, and lower sections stack. At widths up to 760px, a visible Menu control opens the complete navigation in an overlay, the top bar becomes 48px, and content uses 20px 16px padding. Metrics form two columns with 13px 16px padding per cell; their supporting copy is hidden. Forms become one column; search occupies the available width. Page headings use the mobile role, and heading sections and metrics use an 18px bottom margin.

Tables retain their columns and scroll horizontally rather than squeezing records into unreadable widths. The request extension sets table cell padding to 16px and heading padding to 13px 16px at all widths, overriding the earlier desktop and mobile cell padding. Request titles and secondary lines wrap within 360px; mobile titles retain a 230px minimum width. Form grids use an 18px gap.

Request-type summaries share one divided strip that remains horizontal on mobile, using equal compact columns with 12px 8px padding and an 18px bottom margin. Mobile summaries hide decorative icons, arrows, and the extra word after active counts. Settings sheets have a 920px maximum width; settings rows use 25px 28px padding and a 24px gap. At the mobile breakpoint, sheet headings and settings rows use 22px 20px padding, the footer stacks, and its save action aligns left. Settings tabs and mobile request filters scroll horizontally without wrapping. Inbox rows use 22px 25px padding and a 16px gap, reducing to 20px 16px padding and an 11px gap on mobile.

## Elevation & Depth

Record sheets use borders and tonal layering without shadows. Dialogs, disclosed mobile navigation, and transient toast feedback carry soft shadows to distinguish overlays from the persistent register.

Dialog arrival lasts 0.2s with `cubic-bezier(.16,1,.3,1)`, settling from a 5px downward offset and 0.9 opacity into place. Reduced-motion preference disables this animation.

### Shadow Vocabulary
- **Dialog:** `0 18px 70px #102b302e`, with a translucent `#19352666` backdrop.
- **Toast:** `0 5px 22px #12291526`.
- **Mobile navigation overlay:** `0 12px 30px #163e3024`, separating the disclosed destinations from workspace content.

**The Sheets Stay Flat Rule.** Persistent metrics, panels, and tables use a border; overlay shadows stay with dialogs, disclosed mobile navigation, and toast feedback.

## Shapes

Corners stay modest: small rectangular tags, gently curved fields and navigation, slightly softer primary actions and panels, and the largest radius for dialogs and the sign-in panel. Status dots and user initials use circles. Icons are inline SVG stroke drawings, not text glyphs.

Settings switches introduce a capsule radius (15px) around a circular white thumb (20px); this is a functional control shape, not a change to sheet or dialog corners.

## Components

### Buttons

Primary actions use operations green, white bold text (700), a compact horizontal icon gap (8px), and the action radius. Secondary actions use white with a subdued border (`#bdcdc1`); hover adds a pale green wash (`#edf3ee`). Quiet actions are transparent green text. Button backgrounds transition over 0.16s; reduced-motion preference disables transitions. Disabled buttons use half opacity and a wait cursor.

### Chips

Status and priority tags combine a colored dot with a written label. Their radius and padding come from the tag tokens; semantic variants use the paired state colors. Filter tabs are buttons with a selected pale green background (`#eaf2e8`) and stronger text weight (700). Mobile filter tabs retain one horizontally scrolling row rather than wrapping.

### Cards / Containers

White paper panels use the panel radius and a one-pixel sheet-line border. Panel headers use 21px 22px padding; record rows use 17px 22px padding. The work register clips rounded outer corners while the table wrapper handles horizontal overflow.

### Inputs / Fields

Labels sit above fields with a 7px gap. Inputs, selects, and textareas use a white background, one-pixel `#bfcec3` border, field radius, and 10px padding. Textareas start at 95px height and resize vertically. Interactive elements receive a two-pixel `#277653` focus-visible outline offset by 4px. Inline form errors are textual and use `#a02c25`.

Search places its focus indicator on the enclosing field using `:focus-within`: a two-pixel `#277653` outline offset by 3px.

### Navigation

Desktop navigation is a vertical list of icon-and-label buttons, using 11px 12px padding; active destinations have a pale green fill and darker green text. Hover uses `#e4ede3`. The expanded desktop navigation scrolls vertically when needed. Enabled request types use distinct labeled destinations with inline SVG icons alongside the All requests aggregate destination. When all request types are disabled, their destinations and the aggregate destination are omitted.

Mobile navigation starts collapsed behind a visible Menu button. The control carries `aria-controls` and synchronizes `aria-expanded`; selected destinations retain `aria-current`. The disclosed panel sits 66px below the sidebar top with 12px side insets, 10px inner padding, and a maximum height of `calc(100dvh - 90px)`, scrolling vertically as needed. Its full-width destinations use 13px text and 12px padding; counts are visible. Escape closes it and returns focus to Menu; choosing a destination rerenders it closed. Sign-out remains visible in the top bar.

### Work register

Columns pair a stronger request title with building and asset metadata, followed by priority, status, assignment, and due date. The All requests aggregate and mixed dashboard registers add a written request-type column with an icon. Row hover is a pale wash (`#f8fbf6`); actionable rows have keyboard focus and Enter activation. A footer states the number of displayed records. Disabled request types use the existing notice and empty-register patterns with explicit text and an administrator configuration action; preserved records are not styled as deleted.

### Request-type strip

Maintenance, Schedule, and Technology summaries use the same white divided sheet and green text, with a pale icon square, a 13px bold type label, a 12px active count, and an arrow. Hover uses `type-hover`. Only enabled types appear; the strip disappears when empty. Mobile summaries remain a compact horizontal strip with vertical dividers, 12px labels and 11px counts; icons, arrows, and the trailing word after active counts are hidden. Request types retain explicit words without adding a new color family.

### Settings tabs and switches

Settings and notifications share a flat tab bar with 25px gaps (21px on mobile), 13px semibold text, and a two-pixel green underline for the selected tab. Settings rows place a 14px bold label and 13px description opposite a switch. Request-type rows additionally show 12px saved-record and visibility text.

Switches use a real checkbox with switch semantics, a 44px by 26px track, and a white 20px thumb inset by 3px. Checked tracks turn green and the thumb translates 18px. Focus appears on the visible track using the standard two-pixel outline and 4px offset. Background and thumb transitions last 0.16s and respect reduced-motion preference. Changes are saved through the existing primary action.

### Notifications

The top-bar bell is a bordered compact action with a labeled unread count and an accent hover wash. Inbox records use pale icon squares, 14px bold actionable titles, 13px message copy, and 12px metadata. Unread rows add the `unread` wash and a labeled mark-as-read action; read rows retain the normal paper surface. Empty inboxes use a circular icon wash, a 17px heading, and 13px copy. Notification preferences reuse the settings sheet and switches without creating a separate visual language.

## Do's and Don'ts

### Do:
- **Do** pair status color with a written label.
- **Do** preserve aligned rows and tabular dates and counts.
- **Do** use flat white sheets for persistent records.
- **Do** retain horizontal table scrolling on mobile.
- **Do** use the shipped Manrope family and inline SVG icons.

### Don't:
- **Don't** communicate urgency or completion through color alone.
- **Don't** apply overlay shadows to every register panel.
- **Don't** promote the build's very small supporting text into a general type scale.

Not canonized: inherited 10px comment timestamps and 11px metric/organization metadata remain pending legibility review. New 13px descriptions/controls, 17px settings headings, 12px request metadata, switch states, and inbox washes are intentional shipped extensions, not defects to legitimize. The previously unused accent now serves notification hover and is recorded. Other isolated legacy shades/sizes remain advisory pre-existing drift; this documentation pass does not repair UI. Screenshots show different record counts after browser checks; fixture contents are not visual rules. Roll quality boards were unavailable and no image comp was approved, so this records code and rendered evidence without claiming comp parity.
