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
  v-hdg: "#4ade80"
  v-cog: "#22d3ee"
  v-cts: "#b48cf2"
  v-wind: "#e2e8f0"
  v-current: "#3b82f6"
  v-drift: "#facc15"
  v-route: "#f97316"
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
  bridge-feed:
    backgroundColor: "{colors.surface-0}"
    textColor: "{colors.text}"
    typography: "{typography.numeral}"
    rounded: "{rounded.md}"
    padding: "9px 11px"
  map-tool:
    backgroundColor: "{colors.surface-0}"
    textColor: "{colors.text-2}"
    rounded: "{rounded.md}"
    size: "36px"
---

# Design System: ASD Bridge Simulator

## Overview

**Creative North Star: "The Night Bridge Console"**

One instrument, not a form. The chart is the stage and the ASD console and vector readouts are the product. The system is an integrated bridge display at night: a navy-teal ground, hairline-edged panels, tabular numerals, and color that carries meaning (port, starboard, caution, alarm) rather than decoration. It is built for large bridge screens in low light, so contrast is generous and the text floor is 11px.

Density is high but quiet. Setup lives in collapsible groups and two-column fields; help text hides behind a small info toggle rather than sitting as paragraphs. Floating HUD elements sit on the chart (a slim heading tape top-center, a force-diagram toggle button top-left with its panel under it, a computed north arrow top-right with the overview window below it, a map toolbar bottom-right, the ASD dock bottom-center, a radar and cursor readout bottom-left) so drift and forces are read without scrolling. A bridge feed (route guide, active order, Marina voice, confirmation) floats between the dock and the toolbar and exists only while there is something to say. Groups that serve a secondary task, such as Derrota, start closed.

**Key Characteristics:**
- Three-column shell: 296px setup accordion, full-bleed chart, 304px telemetry; 48px top bar.
- Tonal depth: four navy surface steps and 1px hairlines, with shadows reserved for floating layers.
- DM Mono tabular numerals for every value; Manrope for labels and actions.
- One cyan accent for selection and the primary action; port red and starboard green identify sides.
- One Vector Language: every physical quantity has its own color, its own shape and a labelled tag, from one token set read by both CSS and canvas.
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

### Vector Language
Eight tokens in `:root` (`--v-*`), read by `js/vectors.js` (`ASDVectors.CATALOG` and `colors()`) so the stylesheet and the canvas cannot diverge. The chart legend, the telemetry colour dots and the compass readouts are generated from the same catalogue. Each quantity has a colour and a shape.
- **Heading Green** (#4ade80, solid line): HDG, the bow.
- **Course Cyan** (#22d3ee, dashed, length proportional to SOG): COG, the real track.
- **Steer Lilac** (#b48cf2, dotted with a ring): CTS, the course to steer and the active order.
- **Wind White** (#e2e8f0, barbed): wind, drawn arriving from its source.
- **Current Blue** (#3b82f6, wavy): current, drawn leaving toward its set.
- **Drift Yellow** (#facc15, wedge): the HDG-to-COG angle.
- **Route Orange** (#f97316, route line): the planned track and waypoint badge.
- **Thrust Cyan** (#5fd6d0, thick): net thrust; it reuses Selection Cyan, so it is the one vector sharing a console token.

Port and starboard stay Port Red and Starboard Green everywhere: dock, force diagram, telemetry and legend. The earlier collisions (COG against the accent cyan, correction against route orange, current against the AI violet, and two competing greens) are resolved by this set. Buoy fills (#ef4444, #4ade80, #fbbf24) remain as IALA mark colors on map objects, not console chrome.

### Named Rules
**The Meaning-Only Color Rule.** Port red, starboard green, amber, coral and violet appear only when they encode side, state, alarm or the AI. They are never decorative fills.
**The One Accent Rule.** Cyan alone marks selection, focus and the single primary action on screen.
**The Vector Language Rule.** One quantity, one colour, one shape, one labelled tag. Every arrow on the chart carries its name and value, and a vector colour is never reused for another quantity or for chrome. New vectors are added to the catalogue (token, shape, tag), never hard-coded in a draw call.

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

A fixed application grid (a corner layout pass, `layoutCorner`, seats the floating pieces around the dock): 48px header spanning the top, then setup (296px), chart (flexible), telemetry (304px). Either side panel collapses to 0 and the chart keeps column 2 and expands. Spacing is a 4/8/14px rhythm: 8px between fields and grid gaps, 14px panel gutters, group bodies padded 2px 14px 14px. Two-column field grids are the default in setup.

Adaptation is driven by container queries on the chart (940, 900, 760, 600, 480px) that shrink the dock, narrow the heading tape (width min(340px, max(256px, 100% - 424px)) at 900px and below, against 100% - 190px above it), hide the force model at 600px and re-seat the cursor status, plus viewport queries at 1100px (narrower panels, subtitle hidden) and 760px (single scrolling column: header sticky, chart 72vh, panels below). The bridge feed has three placements chosen by `BridgeFeed.place`: a side column in the gap between dock and toolbar (when at least 230px wide), above the dock next to the toolbar (160-236px), or a full-width top strip under the heading tape on phones. The map toolbar takes 44px targets on coarse pointers. Desktop is primary; mobile is secondary.

## Elevation & Depth

Depth is tonal first: the four surface steps (Console Deep to Lifted) and 1px hairlines separate regions, and panels are flat. Shadows exist only on layers that float above the chart or the page.

### Shadow Vocabulary
- **Float** (`box-shadow: 0 10px 28px rgba(0,0,0,.4)`): heading tape, force model, bridge feed, overview, dock.
- **Map control** (`0 6px 18px rgba(0,0,0,.4)`): map toolbar, force toggle button and mini rose; the north arrow uses a drop-shadow filter of the same weight.
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

### Force Model Panel
A 196px floating column at the top-left of the chart, opened by the force-diagram button in the map toolbar (`aria-pressed` tints it cyan). The panel has an 11px uppercase header, a 174 x 150 canvas (136 x 117 when the chart is short), readouts and a 12px legend, in the same Float surface as the other HUD panels. Under it, the vector list (`#vectorList`, one row per Vector Language quantity) has its own toolbar button; if the list does not fit, the values return to the canvas as compact tags, and if the pilot hides it the canvas keeps arrows and icons only. Both compact, then hide, as the chart gets short or narrower than 600px.

The canvas shows, in the ship frame with the bow up: one water jet per thruster, drawn at the real thruster position and pointing where the water leaves (azimuth + 180 degrees), with length proportional to the engine percentage (100% = 44px) and its percentage written beside it; the thrust (dashed Thrust Cyan, the vector sum of both thrusters); wind and water arrows; and the net force (thick Thrust Cyan), all from the centre of gravity on one shared scale (62px for the largest, labelled "Flecha max."). A dotted guide chains thrust, wind and water up to the tip of the net force. Four small triangles (3.5 to 8px) mark the bow and stern transverse speed over the ground, `V = v +/- r*L/2`: starboard ones are green-outlined pointing right, port ones red-outlined pointing left, the one on the side the end is moving toward is filled and carries the speed in knots.

### Heading Tape
The slim top-center panel (about 76px tall): a 42px canvas tape and one line of HDG, COG and CTS readouts in DM Mono 12px, each with a 7px dot in its Vector Language color. It carries nothing else.

### Vector Canvas
A transparent screen-space canvas over the chart (below the HUD) that draws the vectors around the vessel with a dark casing for contrast on the light chart. Each arrow has a tag naming the quantity and value; tags are placed to avoid the rectangles of the floating UI.

### Bridge Feed
A floating panel (Float surface, 10px radius) of stacked sections divided by hairlines: route guide (correction banner, waypoint badge in Route Orange, cross-track bar), active order (40px progress ring in Steer Lilac turning green when done, order text in DM Mono 14px), Marina voice (34px avatar whose border and 4-bar equaliser are cyan listening, amber thinking, green speaking, with captions), and a confirmation row with a red countdown ring. It is hidden when idle and enters over 220ms.

### Map Toolbar
A 38px column at bottom-right of 36px icon tools (44px on touch) separated by hairlines: zoom, follow ship, overview, radar. Pressed tools tint cyan. The overview window (200px wide, 150px map, pill chips) opens below the north arrow; the north arrow is a 56px dial whose needle is computed from the map projection.

### Signature: ASD Dock
A floating panel at the bottom center: two thruster units (lever plus 132px azimuth wheel image with a 2px side-color ring, numeric readouts below) flanking a central column with a 46px power button and mode actions. The side color (port red or starboard green) is the unit's single variable.

## Do's and Don'ts

### Do:
- **Do** use the surface steps (#08151e to #183242) and 1px hairlines to separate regions.
- **Do** set every changing number in DM Mono with tabular figures.
- **Do** reserve cyan (#5fd6d0) for selection, focus and the one primary action.
- **Do** keep port red and starboard green bound to their side; use amber for warnings and coral for alarms.
- **Do** keep help text behind the small info toggle, and keep all text, including canvas and chart labels, at 11px or larger.
- **Do** draw every chart vector from the Vector Language catalogue with its shape and a labelled tag, and use `--port` and `--stbd` for sides everywhere.
- **Do** draw icons as 16px, 1.75-stroke SVG line glyphs.
- **Do** honor reduced motion: the correction banner, shallow warning, sea overlay, feed entrance, mic pulse, equaliser and order ring animate only without it.

### Don't:
- **Don't** put paragraphs of help text or a stacked form in the sidebar.
- **Don't** use emoji or icon fonts as icons.
- **Don't** add shadows to docked panels or use hard offset shadows.
- **Don't** use saturated color as decoration; it must encode side, state or alarm.
- **Don't** reuse a vector color for another quantity or for console chrome, and don't show a vector without its tag.
- **Don't** set body prose in DM Mono or numerals in Manrope.
