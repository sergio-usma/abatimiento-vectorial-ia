---
name: ASD Bridge Simulator
description: A dark bridge console for training azimuth-drive tug maneuvers on a real chart of Cartagena bay.
colors:
  bg: "#050f16"
  surface-0: "#08151e"
  surface-1: "#0c1c27"
  surface-2: "#112431"
  surface-3: "#183242"
  text: "#e6efef"
  text-2: "#a7bfc4"
  text-3: "#84a0a8"
  accent: "#5fd6d0"
  accent-hi: "#86e8e2"
  accent-ink: "#031c1b"
  port: "#f4948b"
  starboard: "#aede90"
  warn: "#f4c76a"
  alert: "#ff8077"
  violet: "#b9aaf0"
typography:
  title:
    fontFamily: "Manrope, system-ui, Segoe UI, sans-serif"
    fontSize: "15px"
    fontWeight: 800
    lineHeight: 1.4
    letterSpacing: "0.01em"
  label:
    fontFamily: "Manrope, system-ui, Segoe UI, sans-serif"
    fontSize: "11px"
    fontWeight: 800
    lineHeight: 1.4
    letterSpacing: "0.08em"
  body:
    fontFamily: "Manrope, system-ui, Segoe UI, sans-serif"
    fontSize: "12px"
    fontWeight: 600
    lineHeight: 1.4
  numeral:
    fontFamily: "DM Mono, ui-monospace, Consolas, monospace"
    fontSize: "13px"
    fontWeight: 500
    lineHeight: 1.4
    fontFeature: "tnum"
rounded:
  sm: "6px"
  md: "10px"
  pill: "999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "14px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.accent-ink}"
    typography: "{typography.body}"
    rounded: "{rounded.sm}"
    padding: "0 10px"
    height: "32px"
  button-primary-hover:
    backgroundColor: "{colors.accent-hi}"
  button-secondary:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.text}"
    rounded: "{rounded.sm}"
    padding: "0 10px"
    height: "32px"
  button-secondary-hover:
    backgroundColor: "{colors.surface-3}"
  button-danger:
    textColor: "{colors.alert}"
    rounded: "{rounded.sm}"
    height: "32px"
  input-field:
    backgroundColor: "{colors.surface-0}"
    textColor: "{colors.text}"
    typography: "{typography.numeral}"
    rounded: "{rounded.sm}"
    padding: "0 9px"
    height: "32px"
  group-header:
    textColor: "{colors.text-2}"
    typography: "{typography.label}"
    padding: "0 14px"
    height: "40px"
  tab-selected:
    backgroundColor: "{colors.surface-3}"
    textColor: "{colors.text}"
    rounded: "4px"
    height: "28px"
  readout-row:
    backgroundColor: "{colors.surface-1}"
    textColor: "{colors.text}"
    typography: "{typography.numeral}"
    padding: "6px 9px"
  hud-panel:
    backgroundColor: "{colors.surface-0}"
    textColor: "{colors.text-2}"
    rounded: "{rounded.md}"
    padding: "12px"
---

# Design System: ASD Bridge Simulator

## Overview

**Creative North Star: "The Night Bridge Console"**

One instrument, not a form. The chart is the stage and the ASD console and vector readouts are the product. The system is an integrated bridge display at night: a navy-teal ground, hairline-edged panels, tabular numerals, and color that carries meaning (port, starboard, caution, alarm) rather than decoration. It is built for large bridge screens in low light, so contrast is generous and the text floor is 11px.

Density is high but quiet. Setup lives in collapsible groups and two-column fields; help text hides behind a small info toggle rather than sitting as paragraphs. Floating HUD elements sit on the chart (compass top-center, a collapsible force-model pill top-left under the zoom control at top 100px / left 12px, rose top-right, ASD dock bottom-center) so drift and forces are read without scrolling. Groups that serve a secondary task, such as Derrota, start closed.

**Key Characteristics:**
- Three-column shell: 296px setup accordion, full-bleed chart, 304px telemetry; 48px top bar.
- Tonal depth: four navy surface steps and 1px hairlines, with shadows reserved for floating layers.
- DM Mono tabular numerals for every value; Manrope for labels and actions.
- One cyan accent for selection and the primary action; port red and starboard green identify sides.
- Drawn SVG line icons (16px, 1.75 stroke), no emoji.

## Colors

A restrained deep-navy palette with one cyan accent; saturated hues appear only when they encode side, state, or alarm.

### Primary
- **Selection Cyan** (#5fd6d0): the primary button fill, selected toggles, focus ring, azimuth readout, index marks, cross-track bar. Its bright hover is Selection Cyan Bright (#86e8e2); text on it is Cyan Ink (#031c1b).

### Secondary
- **Port Red** (#f4948b): the port thruster unit (title dot, lever fill, azimuth ring).
- **Starboard Green** (#aede90): the starboard thruster unit, heading value, running status, manual mode, "ok" correction.

### Tertiary
- **Caution Amber** (#f4c76a): warnings, auto mode, net force, waypoint badge, mid correction.
- **Alarm Coral** (#ff8077): stop and power-off state, danger rows, high correction, grounding.
- **Copilot Violet** (#b9aaf0): the AI copilot response and course-to-steer readout.

### Neutral
- **Night Chart Navy** (#050f16): window and chart ground.
- **Console Deep** (#08151e): top bar, input wells, tab track.
- **Console Panel** (#0c1c27): side panels and readout rows.
- **Console Raised** (#112431): buttons, toasts, hover fills.
- **Console Lifted** (#183242): selected tab, button hover.
- **Instrument White** (#e6efef): primary text and numerals.
- **Chart Mist** (#a7bfc4): secondary text and group headers.
- **Dim Slate** (#84a0a8): tertiary labels and units.
- Hairlines are the teal-grey rgba(158,205,214) at .13 (dividers) and .28 (control borders).

### Chart overlay colors (named exception)
The map vectors and charts carry their own brighter hues so they stay legible over the light nautical chart, and the legend swatches repeat them: COG cyan (#00d4ff), CTS lilac (#b48cf2), correction and route orange (#f97316), current violet (#a78bfa), and the buoy fills (#ef4444, #4ade80, #fbbf24). These are tied to the map vectors, the compass tape and the Chart.js series, not to the console UI, and are deliberately off the console tokens. A token linter will report them as off-token; that is expected, not drift to fix. Do not use them for console chrome.

### Named Rules
**The Meaning-Only Color Rule.** Port red, starboard green, amber, coral and violet appear only when they encode side, state, alarm or the AI. They are never decorative fills.
**The One Accent Rule.** Cyan alone marks selection, focus and the single primary action on screen.

## Typography

**Display Font:** none; the app name is set in Manrope 800.
**Body Font:** Manrope (variable 200-800, self-hosted, with system-ui and Segoe UI fallback)
**Label/Mono Font:** DM Mono (400 and 500, self-hosted, with ui-monospace and Consolas fallback)

**Character:** Manrope is a clean geometric UI voice for labels and actions; DM Mono gives every number fixed-width tabular alignment so changing readouts do not jitter.

### Hierarchy
- **Title** (800, 15px, 1.4): app name in the top bar; its subtitle drops to 12px / 500 in Dim Slate.
- **Label** (800, 11px, 0.08em, uppercase): accordion group headers, HUD panel headers, cursor tag.
- **Body** (600, 12px, 1.4): field labels (11px), buttons (700), tabs, notes at 1.5 line height.
- **Numeral** (500, 13px, tabular-nums): inputs, readouts, compass values; scales, ticks, the compass tape and canvas labels use DM Mono at 11-12px (bold on the cardinal and waypoint labels), and the chart sounding subscript is 11px.
- **Modal heading** (800, 20px): crash card only.

### Named Rules
**The Tabular Numerals Rule.** Every changing number is DM Mono with tabular figures. Prose and labels never use it.
**The 11px Floor Rule.** Nothing on the interface or the chart is below 11px, including chart-drawn labels and sounding subscripts. There is no exception.

## Layout

A fixed application grid: 48px header spanning the top, then setup (296px), chart (flexible), telemetry (304px). Either side panel collapses to 0 and the chart keeps column 2 and expands. Spacing is a 4/8/14px rhythm: 8px between fields and grid gaps, 14px panel gutters, group bodies padded 2px 14px 14px. Two-column field grids are the default in setup.

Adaptation is driven by container queries on the chart (940, 900, 760, 600, 480px) that shrink the dock, narrow the compass HUD (width min(340px, max(220px, container - 440px)) at 900px and below, against container - 190px above it), hide the force model at 600px and re-seat the cursor status, plus viewport queries at 1100px (narrower panels, subtitle hidden) and 760px (single scrolling column: header sticky, chart 72vh, panels below). Desktop is primary; mobile is secondary.

## Elevation & Depth

Depth is tonal first: the four surface steps (Console Deep to Lifted) and 1px hairlines separate regions, and panels are flat. Shadows exist only on layers that float above the chart or the page.

### Shadow Vocabulary
- **Float** (`box-shadow: 0 10px 28px rgba(0,0,0,.4)`): compass, force model, dock.
- **Map control** (`0 6px 18px rgba(0,0,0,.4)`): zoom bar and mini rose.
- **Popup** (`0 8px 24px rgba(0,0,0,.5)`, toasts at `0 10px 28px rgba(0,0,0,.5)`): popups and toasts.
- **Modal** (`0 24px 64px rgba(0,0,0,.65)`): crash card, expanded rose.

### Named Rules
**The Flat Panels Rule.** Docked panels never carry shadows; only floating layers do, and always soft, large-blur, black.

## Shapes

Instrument-soft rectangles: 6px for controls, buttons and inputs, 10px for floating panels and the crash card, 4px for tab and checkbox insets, full circles for the rose, status pill, azimuth wheel and dots. Borders are 1px hairlines; the azimuth wheel takes a 2px ring in its side color. Dashed hairline borders mark optional info notes.

## Components

Quiet and instrument-like: low-contrast at rest, one clear highlight per state.

### Buttons
- **Shape:** 6px radius, 32px minimum height, 12px / 700 Manrope.
- **Primary:** Selection Cyan fill with Cyan Ink text. The dock power button is the only filled-accent primary; the top-bar Iniciar is a secondary button.
- **Secondary:** Console Raised fill, 28% hairline border; hover lifts to Console Lifted.
- **Danger / power-on state:** coral text on a 7-10% coral tint with a coral border; hover fills solid coral.
- **Active toggle:** cyan text and border on a 13% cyan tint. Mode toggle borders go green (manual) or amber (auto).
- **Press:** 1px downward nudge; disabled at 50% opacity. Focus is a 2px cyan outline offset 2px.

### Inputs / Fields
- **Style:** Console Deep well, 1px hairline border, 6px radius, 32px high, DM Mono 13px, unit tag in Dim Slate at the right.
- **Focus:** 2px cyan outline at 1px offset; hover brightens the border. Selects use Manrope with a drawn chevron.
- **Checkbox:** 18px, 4px radius; checked fills cyan with a dark tick.

### Navigation
- **Group headers:** 40px high, 11px uppercase label, chevron rotates 180 degrees when open.
- **Tabs:** segmented strip in a recessed track; selected tab is Console Lifted with white text.
- **Top bar:** brand mark (30px cyan-tint tile), app name, a pill status chip, 34px icon buttons that tint cyan when pressed.

### Telemetry Readouts
Label left in Dim Slate, DM Mono value right, rows divided by 1px gaps inside a rounded outline. State is shown by value color (cyan info, amber warn) or a coral row tint for danger.

### Force Model Pill
A 196px collapsible floating panel (details/summary) pinned under the zoom control: a 34px summary with an 11px uppercase label and a rotating chevron, then a 174 x 150 canvas and a 12px legend. It is the same Float surface as the other HUD panels and hides below 600px chart width.

### Signature: ASD Dock
A floating panel at the bottom center: two thruster units (lever plus 132px azimuth wheel image with a 2px side-color ring, numeric readouts below) flanking a central column with a 46px power button and mode actions. The side color (port red or starboard green) is the unit's single variable.

## Do's and Don'ts

### Do:
- **Do** use the surface steps (#08151e to #183242) and 1px hairlines to separate regions.
- **Do** set every changing number in DM Mono with tabular figures.
- **Do** reserve cyan (#5fd6d0) for selection, focus and the one primary action.
- **Do** keep port red and starboard green bound to their side; use amber for warnings and coral for alarms.
- **Do** keep help text behind the small info toggle, and keep all text, including canvas and chart labels, at 11px or larger.
- **Do** keep chart overlay colors on the map vectors and legend only.
- **Do** draw icons as 16px, 1.75-stroke SVG line glyphs.
- **Do** honor reduced motion: only the correction banner, shallow warning and sea overlay animate.

### Don't:
- **Don't** put paragraphs of help text or a stacked form in the sidebar.
- **Don't** use emoji or icon fonts as icons.
- **Don't** add shadows to docked panels or use hard offset shadows.
- **Don't** use saturated color as decoration; it must encode side, state or alarm.
- **Don't** set body prose in DM Mono or numerals in Manrope.
