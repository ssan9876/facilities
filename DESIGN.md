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
  admin-check: "#246a49"
  admin-divider: "#dfe5df"
  admin-muted: "#52635a"
  command-surface: "#f3f6f4"
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
  admin-label:
    fontFamily: "Manrope, Segoe UI, sans-serif"
    fontSize: "14px"
    fontWeight: 600
  technical:
    fontSize: "13px"
    lineHeight: 1.6
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
  settings-tab-mobile:
    textColor: "{colors.muted}"
    typography: "{typography.control}"
    padding: "10px 0"
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
  admin-field:
    backgroundColor: "{colors.paper}"
    rounded: "{rounded.navigation}"
    padding: "11px"
    width: "100%"
  admin-checkbox:
    size: "18px"
  technical-block:
    backgroundColor: "{colors.command-surface}"
    typography: "{typography.technical}"
    padding: "16px"
---

# Design System: Facilities

## Overview

**Creative North Star: "Civic operations records"**

A quiet green navigation rail frames white work sheets and aligned registers. The implemented interface favors readable records, modest corners, clear field labels, and restrained actions. This descriptive name comes from the direction contract; no approved image composition exists.

The locally bundled Manrope family connects page headings, table records, forms, and navigation. A single organization shares one visual workspace; different buildings and equipment use the same record language.

Administrators can edit the workspace name and welcome message and select one of the existing SVG icons. These identity choices personalize copy and the sign-in/navigation mark while preserving the green register system.

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
- **Administration green** (`admin-check`): checked native administration checkboxes; this existing green variant does not introduce a separate administration palette.
- **Administration divider and metadata** (`admin-divider`, `admin-muted`): repeated person/group boundaries, membership fieldsets, and supporting account/group text.
- **Technical surface** (`command-surface`): fallback wash used by preformatted update commands and provisioning connection details when no `--surface` override exists.

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
- **Administration label:** 14px semibold field labels; inline checkbox labels use regular weight (400).
- **Technical:** 13px preformatted command/connection text with line height 1.6. The browser's native preformatted font is retained rather than adding another bundled family.

**The Register Numerals Rule.** Keep dates and counts aligned with tabular numerals in tables and metrics.

The request extension intentionally enlarges table headings and status tags to 11px, and request secondary lines and table footers to 12px. This supersedes the original 10px heading/tag and 11px secondary/footer styling. Earlier compact choices still persist in organization and metric metadata (11px) and comment timestamps (10px); they remain implementation details pending legibility review rather than a general scale for new surfaces.

## Layout

The desktop shell reserves a fixed sidebar (236px) and places the workspace in the second column. The top bar is 77px high. Content has a 1510px maximum width and desktop padding of 36px 38px 50px. Summary metrics share one divided sheet; lower summary sections form a 1.3fr / 1fr grid with a 26px gap.

At widths up to 1100px, the sidebar becomes 210px, content uses 28px 24px padding, and lower sections stack. At widths up to 760px, a visible Menu control opens the complete navigation in an overlay, the top bar becomes 48px, and content uses 20px 16px padding. Metrics form two columns with 13px 16px padding per cell; their supporting copy is hidden. Forms become one column; search occupies the available width. Page headings use the mobile role, and heading sections and metrics use an 18px bottom margin.

Tables retain their columns and scroll horizontally rather than squeezing records into unreadable widths. The request extension sets table cell padding to 16px and heading padding to 13px 16px at all widths, overriding the earlier desktop and mobile cell padding. Request titles and secondary lines wrap within 360px; mobile titles retain a 230px minimum width. Form grids use an 18px gap.

Request-type summaries share one divided strip that remains horizontal on mobile, using equal compact columns with 12px 8px padding and an 18px bottom margin. Mobile summaries hide decorative icons, arrows, and the extra word after active counts. Settings sheets have a 920px maximum width; settings rows use 25px 28px padding and a 24px gap. At the mobile breakpoint, sheet headings and settings rows use 22px 20px padding, the footer stacks, and its save action aligns left. Settings tabs wrap to expose every destination; mobile request filters retain horizontal scrolling without wrapping. Inbox rows use 22px 25px padding and a 16px gap, reducing to 20px 16px padding and an 11px gap on mobile.

Administration forms use a single-column grid with a 16px gap, 24px padding, and a 720px maximum width, including within the wider settings sheet. Group membership fieldsets have 16px padding, a 12px row gap, and 24px side and bottom margins. These forms retain their padding on mobile; headings directly inside an administration form have no extra inner padding. Primary administration actions align to the start on desktop and stretch within the form at widths up to 700px. The expanded settings destinations wrap in the existing tab bar rather than creating a second navigation pattern.

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

Settings and notifications share a flat wrapping tab bar with 25px gaps (21px between 701px and 760px), 13px semibold text, and a two-pixel green underline for the selected tab. At widths up to 700px, tab gaps become 4px vertically and 12px horizontally, with 10px vertical button padding. Every label stays visible instead of requiring a horizontal tab scroll. Settings rows place a 14px bold label and 13px description opposite a switch. Request-type rows additionally show 12px saved-record and visibility text.

Switches use a real checkbox with switch semantics, a 44px by 26px track, and a white 20px thumb inset by 3px. Checked tracks turn green and the thumb translates 18px. Focus appears on the visible track using the standard two-pixel outline and 4px offset. Background and thumb transitions last 0.16s and respect reduced-motion preference. Changes are saved through the existing primary action.

### Notifications

The top-bar bell is a bordered compact action with a labeled unread count and an accent hover wash. Inbox records use pale icon squares, 14px bold actionable titles, 13px message copy, and 12px metadata. Unread rows add the `unread` wash and a labeled mark-as-read action; read rows retain the normal paper surface. Empty inboxes use a circular icon wash, a 17px heading, and 13px copy. Notification preferences reuse the settings sheet and switches without creating a separate visual language.

### Administration forms

Identity, People, Groups, and Provisioning extend the existing settings sheet. Administration inputs and selects use white paper, the shared line border, 11px padding, and a 6px radius. Labels sit 7px above fields. Native checkboxes are 18px squares with a green checked accent and 10px spacing to regular-weight text; they reuse the standard focus-visible outline. Forms retain the existing green primary action and textual error feedback; empty error elements are hidden. Creation actions explicitly say "Provision person", "Create group", or "Create token", while group edits say "Save group" and identity/account edits retain "Save changes".

Identity edits the workspace name, welcome message, and a selected Building, Maintenance, Technology, or Calendar SVG icon. Workspace names wrap within the brand and organization containers. People cards separate account identity from editable non-administrator roles and account-enabled state. Protected administrator entries explicitly say "Administrator · Protected" and omit editing controls. Group sections combine labeled fields, automatic assignment checkboxes, and a bordered fieldset whose legend says "Members · Changes save immediately". Manual membership uses checkbox state; explanatory copy names automatic provisioning and later provider synchronization rather than inventing source-colored membership badges. Membership changes save immediately, while group details use the primary save action.

### Technical blocks and provisioning states

Preformatted technical blocks are now reused for update commands, SCIM/REST connection URLs, and newly created provisioning tokens. They use the technical typography role, 16px padding, the technical wash, `white-space: pre-wrap`, and `overflow-wrap: anywhere` so long values wrap within narrow sheets.

Provisioning token rows state an expiry date or "Revoked" in words; active rows expose a quiet Revoke action. Newly created token values appear in a notice-colored sheet section with the explicit instruction "Copy this token now. It is shown once." and an "I saved the token" dismissal action. No persistent secret value or token-specific status color is established by this system. The token form uses the same administration fields for connection name and expiry days.

### Records lifecycle, request detail and operations pages

Registers gain a trailing quiet **Edit** action per row (with the record name in its accessible label) for managers, a **Show archived** checkbox when archived rows exist, and an **Export** secondary link where CSV exports apply. Archived rows keep their place in the register with a neutral written **Archived** tag; paused maintenance plans use the hold-amber **Paused** tag. Edit dialogs reuse the form grid; lifecycle actions (**Archive**/**Restore**, **Delete**) sit at the start of the dialog's action row, separated from **Cancel** and the primary save. Destructive actions use a rust-outlined secondary button and confirm in place: the first press changes the label to an explicit question and fills the button rust; the second press acts. No browser confirmation dialogs are used.

The request dialog adds a toolbar (**Edit details**, **Activity**, **Delete request**), then optional reservation, status, activity, attachment, parts and conversation sections divided by sheet lines with 15px section titles. Reservation states are written tags (**Awaiting approval** amber, **Reserved** green, **Declined**/**Cancelled** neutral). Attachments list a 64px thumbnail or file symbol, a single accessible file link, size, uploader and time. Activity and the audit log share one history list: actor in bold, summary, 12px timestamp, and field changes as `before → after` lines.

Inventory flags parts at or below their reorder level with the rust **Low stock** tag beside the quantity and a notice above the register; the overview adds a **Low stock** panel. Reports reuse the divided metrics sheet for period totals and a responsive grid of panels holding breakdown tables (count, share and completed columns) rather than charts. The audit log is a settings sheet with a four-column filter row that stacks on mobile.

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

Not canonized: inherited 10px comment timestamps and 11px metric/organization metadata remain pending legibility review. Administration's repeated checkbox/divider treatments and technical blocks are intentional shipped extensions; fixture workspace names, record counts, endpoint hosts, and token values are not design tokens. Final corrections hide blank error elements and remove nested identity heading padding; neither earlier defect becomes a spacing doctrine. Other isolated legacy shades/sizes remain advisory pre-existing drift; this documentation pass does not repair UI. Roll quality boards were unavailable and no image comp was approved, so this records code and rendered evidence without claiming comp parity.
