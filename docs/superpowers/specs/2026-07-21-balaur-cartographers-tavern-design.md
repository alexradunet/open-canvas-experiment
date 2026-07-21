# Balaur Cartographer’s Tavern rebrand — design specification

**Date:** 2026-07-21  
**Status:** Approved in brainstorming  
**Scope:** Rebrand the current Orbit JSON Canvas prototype as Balaur without replacing or integrating the separate `../balaur` application

## Summary

Rebrand Orbit as **Balaur**, a spatial personal life OS that feels like a cartographer’s tavern: carved oak application furniture around an inked map table, with portable parchment cards arranged across it. The experience remains a serious local-first tool. Its RPG character comes from material, typography, and one small companion presence rather than renamed controls or decorative effects on every surface.

The redesign must improve **canvas readability first**. It preserves the existing static, standards-first architecture, JSON Canvas interoperability, SQLite task projections, Johnny Decimal hierarchy, Today view, AI tools, and interaction model.

## Subject, audience, and single job

- **Subject:** Balaur, a local-first spatial life-management application.
- **Audience:** One owner organizing life administration, health, work, money, relationships, learning, travel, and archives through JSON Canvas and Johnny Decimal.
- **Single job:** Let the owner see and shape their life as a readable spatial map.

## Why this direction

The existing Balaur application in `../balaur` established a distinctive Hearthwood identity: a dark tavern study, oak surfaces, candle gold, teal assistant state, serif narrative text, mono operational text, tactile controls, and a dragon companion. It also grew into a generalized OCTANT component system and a multi-route life OS whose visible chrome often competes with sparse content.

This project takes the useful identity without taking the platform complexity. It does not copy OCTANT, its 112-component surface area, RPG dialogue system, baked glyph pipeline, or multi-route application shell. It distills Hearthwood into the existing canvas application.

## Goals

1. Make node type, hierarchy, status, and selection easier to scan at several zoom levels.
2. Give Balaur an unmistakable tavern-map identity without turning the workspace into a decorative RPG HUD.
3. Keep ordinary actions plain: create tasks, open canvases, save files, and resolve errors using language the owner recognizes.
4. Preserve all existing behavior and portable data contracts.
5. Remain responsive, keyboard-usable, legible, and respectful of reduced-motion preferences.

## Non-goals

- No integration with or replacement of `../balaur`.
- No React, OCTANT, component library, package manager, build system, or runtime dependency.
- No copied tavern dialogue UI, quest terminology, experience levels, inventory slots, or pervasive runes.
- No changes to task workflow, SQLite schema, JSON Canvas structure, Johnny Decimal rules, AI operation behavior, or application navigation.
- No rename of internal browser storage keys or existing `orbit:` Markdown marker namespaces.
- No new light theme in this pass.

## Considered approaches

### Hearthwood Cartography — selected

A warm map room in which canvas readability leads. The shell provides tavern material; the map remains calm; selection receives the memorable Balaur gesture.

**Advantages:** strongest balance of spatial clarity, existing workflow compatibility, and distinctive identity.  
**Risk:** an overly restrained execution could read as generic dark productivity software.

### Balaur Index

Johnny Decimal identifiers become the dominant visual grammar through card spines, shelf marks, and coordinate tabs.

**Advantages:** strongest archival hierarchy and dense-data scanning.  
**Risk:** less organic, less canvas-like, and too close to a filing system.

### Quiet Hearth

Most chrome disappears while a small Balaur companion carries the emotional identity.

**Advantages:** calmest all-day workspace.  
**Risk:** weakest node differentiation and insufficient RPG personality.

## Generic-default critique and revision

The first Hearthwood Cartography proposal removed tavern texture to avoid generic fantasy styling. That overcorrected. Dark brown, gold, and serif type without a material world would still be generic, only cleaner.

The approved revision creates a specific fictional place: **the Cartographer’s Tavern**. Texture is zoned rather than removed:

- carved oak belongs to application furniture;
- the central canvas is an inked map table;
- nodes are movable parchment objects;
- selection is a cartographic bearing that also reads as a coiling dragon;
- a single resting familiar represents Balaur and opens the assistant.

The design does not spend personality on gradients, rounded SaaS cards, decorative section numbering, or fantasy vocabulary. It spends it on the material model and the selection/familiar signatures.

## Visual system

### Color tokens

The compact identity palette contains six fixed roles:

| Name | Value | Role |
|---|---:|---|
| Soot | `#100D0B` | canvas depth, scrims, deepest recesses |
| Tavern oak | `#24150C` | header, sidebar, inspector, carved controls |
| Map parchment | `#D7C48F` | node cards, Today sheets, dialog folios |
| Candle gold | `#F2C14E` | primary action, active selection, bearing line |
| Balaur teal | `#5ED0BD` | focus, links, assistant state, connection detail |
| Leather edge | `#806438` | parchment borders, dividers, inactive structure |

Supporting text and ink values derive from the existing palette:

- warm shell text: `#F1E7D4` and `#CFC1AA`;
- parchment ink: `#2A2015` and `#66583C`;
- existing JSON Canvas preset colors remain document semantics and are not replaced by theme accents.

### Typography

Use the three already self-hosted families. Do not add a fourth display or pixel face.

| Role | Face | Use |
|---|---|---|
| Display and card title | Newsreader | canvas titles, node headings, Today heading, dialog title |
| Interface and prose | Work Sans | buttons, labels, descriptions, task content, empty/error guidance |
| Coordinates and metadata | JetBrains Mono | Johnny Decimal IDs, dates, statuses, zoom, save state, technical metadata |

Newsreader is restrained to short phrases. Work Sans carries most of the interface so the product remains readable. JetBrains Mono must not become the default body face.

### Material roles

1. **Carved oak furniture:** top bar, library, inspector, toolbars, assistant frame, and actionable controls. Use subtle plank variation, a hard near-black outline, and one inset highlight. Grain never repeats inside every nested section.
2. **Inked map table:** the canvas field. Keep a low-contrast coordinate grid and a localized candle-warm falloff; avoid high-frequency texture behind text.
3. **Parchment objects:** canvas cards, Today task groups, and dialog folios. Use dark ink, a leather edge, and one hard offset shadow to establish portability.
4. **Inset wells:** portal previews, form controls, minimap, and technical details. Use darker surfaces and no extra drop shadow.
5. **Elevation:** dialogs, menus, sheets, and the assistant panel only.

## Signature elements

### Balaur bearing

A selected card receives two imperfect contour rings. One is candle gold and one is Balaur teal. Together they read as a map bearing and as a dragon coiling around something the owner has chosen to keep.

- Draw once in approximately 160 ms when selection changes.
- Do not loop, pulse, or appear around unselected cards.
- Render immediately under `prefers-reduced-motion: reduce`.
- Preserve the ordinary selection outline beneath the signature for clarity.

### Resting familiar

A single small Balaur ember provides the assistant entry point.

- On desktop, it is a labeled `Ask Balaur` control docked at the lower edge of the map.
- On narrow layouts, the same labeled control moves to the top bar so it does not compete with canvas tools.
- Render only one assistant entry point in each layout.
- Resting state is quiet and static.
- Teal indicates ready or contextual recall; candle gold indicates attention; error state includes text and is never color-only.
- Activating it opens the existing assistant panel.
- It has a visible focus ring and accessible name; it is not ambient decoration.

## Layout

### Desktop

```text
┌──────────────────────────────────────────────────────────────────────┐
│ ◒ BALAUR       Life index / breadcrumbs      Canvas · Today · Save │
├───────────────┬───────────────────────────────────────┬──────────────┤
│ carved oak    │                                       │ carved oak   │
│ capture shelf │           inked map table             │ inspector    │
│               │                                       │              │
│ canvas tree   │    parchment cards + connections      │ selection    │
│ JD hierarchy  │                                       │ fields       │
│ library       │                          ◒ familiar   │              │
└───────────────┴───────────────────────────────────────┴──────────────┘
```

The canvas keeps the majority of the viewport. The existing library → canvas → inspector workflow remains because it supports spatial editing. Capture actions become a compact carved shelf rather than a field of equally prominent cards.

### Narrow viewport

```text
┌──────────────────────────────┐
│ ☰  BALAUR      Today    Save │
├──────────────────────────────┤
│                              │
│       full-width map         │
│                              │
│  tools                 ◒     │
└──────────────────────────────┘
  library sheet / inspector sheet
```

The map owns the viewport. Library and inspector use the application’s existing overlay/sheet behavior. Canvas tools remain reachable at the bottom. No horizontal clipping is allowed at 390 × 844.

## Component treatment

### Top bar

- Replace visible Orbit identity with Balaur and the familiar sigil.
- Keep canvas breadcrumbs, editable title, Canvas/Today switch, save state, import, and export.
- Replace “Ask Orbit” with the single responsive `Ask Balaur` familiar control defined above; do not keep a duplicate top-bar trigger on desktop.
- Healthy local persistence stays quiet. Failure becomes explicit text with a recovery action where one exists.

### Library and capture shelf

- Keep Note, Goal, Habit, Project, Task, AI note, AI operator, Live widget, and Sub-canvas actions.
- Keep every capture action visible in its existing order. Restyle the collection as a compact carved shelf rather than hiding secondary actions behind a new menu.
- Use carved controls with literal names and short descriptions.
- Retain canvas hierarchy, Johnny Decimal controls, library filters, backup, reset, storage status, and JSON Canvas link.

### Canvas cards

- Treat nodes as parchment slips on the map table.
- Use Newsreader for titles, Work Sans for content, and JetBrains Mono for IDs and metadata.
- Convert the existing JSON Canvas color treatment into a compact wax/thread marker plus text or icon. Do not flood the full parchment card with a semantic color.
- Keep connection handles, resize affordance, Markdown, task checkbox behavior, links, and group semantics intact.
- Group nodes remain map regions with a leather boundary and low-contrast wash rather than becoming solid parchment cards.
- Sandboxed live widgets retain their own rendered content inside a restrained parchment or oak frame.
- Portal cards use a parchment frame around the existing dark miniature map. Their Open action remains explicit.
- At distant zoom, preserve the existing low-detail rendering path; the parchment silhouette and semantic marker must remain distinguishable.

### Edges and tools

- Connections use leather-muted lines by default, candle gold for active selection, and teal for connection creation or assistant-related relationships.
- Edge labels remain readable and are never placed over high-frequency grain.
- Pan, select, connect, note, zoom, fit, and minimap controls use compact carved-oak treatment with 44 px targets where the viewport permits.

### Inspector

- Treat the inspector as a carved ledger cabinet with dark inset form wells.
- Preserve field order and editing behavior.
- Use spacing and one leather divider between logical groups; do not wrap every field in a decorative panel.
- Empty state remains direct: select a card or connection to edit it.

### Today

Today becomes a tavern notice board without becoming a quest log.

- Keep the heading, date, “Add task,” quick capture, and four existing projections.
- Planned today, overdue, inbox/next, and completed remain literal labels.
- Use parchment sheets pinned to the oak board rather than dashboard stat cards.
- Overdue uses a leather-red edge plus text; completed state uses text/icon treatment and reduced contrast.
- Preserve semantic DOM order when columns stack.
- Keep the sentence “Everything else can remain safely in its canvas.” as the connective idea between Today and the spatial system.

### Dialogs

- Present task, Johnny Decimal, AI note, and provider settings as parchment folios laid over a dimmed table.
- Keep native `dialog`, existing labels, validation, close behavior, and focus management.
- Use dark inset fields on parchment only when contrast remains sufficient; otherwise use a lighter parchment well.
- Primary buttons are warm carved oak or ember-dark, not bright gradient CTAs.
- Error and validation copy stays plain and actionable.

### Assistant panel

- Rename Orbit Copilot to Balaur.
- Open it from the familiar control while preserving the existing panel, provider settings, suggestions, message flow, and security copy.
- Use oak for panel chrome, parchment for readable assistant messages, and dark inset slabs for provider or tool detail.
- Do not import the separate Balaur application’s RPG dialogue layout or portrait pipeline.

## Motion

Spend motion on spatial travel and selection:

1. **Sub-canvas travel:** preserve the existing View Transition path; the parchment portal expands into the next inked map. Reverse the transition on return.
2. **Selection:** draw the Balaur bearing once over approximately 160 ms.
3. **Controls:** carved buttons depress 2 px over approximately 80 ms and return immediately.

No continuous grain animation, floating cards, sparkles, random candle flicker, or staggered reveal on routine navigation. Reduced motion removes drawing and travel while preserving immediate state changes.

## Copy and naming

- Product name: **Balaur**.
- Assistant name: **Balaur**; visible actions say “Ask Balaur.”
- Keep ordinary nouns and verbs: Task, Add task, Create task, Open, Save, Import, Export, Today, Overdue, Completed.
- Tavern and cartography language belongs in atmosphere, empty-state illustration, and rare supporting copy—not in control vocabulary.
- Errors state what failed and what the owner can do next. They do not apologize or role-play.

## Rebrand and data boundary

### Rename visibly

- document title and metadata;
- product brand and mark;
- “Orbit” and “Orbit Copilot” user-facing copy;
- assistant actions and status labels;
- starter/onboarding references;
- whole-space backup filename to `.balaur.json`;
- visible help text and accessible names where they refer to the product.

### Preserve internally

- existing `orbit:` Markdown markers;
- existing browser storage keys;
- SQLite schema and records;
- JSON Canvas node and edge data;
- import recognition by JSON content;
- existing element IDs and data attributes unless a markup change strictly requires a local update.

These internal names are a data namespace, not visible brand. Renaming them would create migration risk outside the approved visual rebrand.

## Data flow and behavior

The rebrand does not change data flow:

1. JSON Canvas documents remain the portable spatial source of truth.
2. SQLite remains the indexed workflow source for tasks and related life data.
3. Today remains a projection of the same task records.
4. Canvas nodes continue to reconcile with task markers.
5. AI operations continue to validate and require confirmation before applying changes.
6. Import/export and local persistence keep their current behavior.

## Empty, loading, and error states

- Empty canvas: invite the owner to add a note or open the library; do not show a decorative tavern scene that hides the action.
- Empty Today projection: state what is absent and keep quick capture available.
- Storage initialization: show the existing preparing state; on failure, name local storage/SQLite as the failed subsystem and preserve export guidance if available.
- AI provider failure: retain the attempted action, state the provider error, and direct the owner to provider settings or local mode.
- Import failure: identify invalid JSON Canvas or whole-space data; do not mutate the current workspace.
- Reduced connectivity or provider status is text-backed and not conveyed by ember color alone.

## Accessibility

- Meet WCAG AA contrast for normal text on oak, map, parchment, and inset form surfaces.
- Retain semantic landmarks, forms, labels, native dialogs, buttons, and headings.
- Keep all existing keyboard shortcuts and canvas focus behavior.
- Provide a visible teal focus outline on every material.
- Use 44 px minimum interactive targets on touch-oriented layouts.
- Pair every semantic color with text, icon, shape, or position.
- Preserve full accessible names when titles visually clamp.
- Respect `prefers-reduced-motion` for transitions, bearing draw, and button movement.
- Do not let texture reduce text or edge legibility.

## Implementation boundaries

Expected files remain within the current application:

- `index.html`: visible Balaur naming, mark, labels, and narrowly scoped structural classes.
- `styles/foundation.css`: palette aliases, typography, material and motion tokens.
- `styles/shell.css`: oak top bar, capture shelf, library, and shell geometry.
- `styles/canvas.css`: map table, parchment nodes, portal frames, bearing, edges, familiar, tools, and minimap.
- `styles/components.css`: inspector, Today, assistant, dialogs, forms, notices, and toasts.
- `styles/responsive.css`: sheet behavior, stacked Today view, touch targets, and narrow viewport fixes.
- `styles/themes.css`: preserve AI-selectable canvas themes only where they do not conflict with legibility; do not add another application theme.
- `app.js`: user-facing naming, backup filename, and only the minimal class/state hooks required by the visual system.
- `README.md` and existing design-system documentation: update visible product identity and describe the distilled Hearthwood relationship after the implementation works.

Do not edit `storage/life-store.js` unless a visible product string exists there. Do not change schema, marker, or storage contracts.

## Verification contract

### Desktop smoke check — 1440 × 1000

1. Load the seeded workspace and confirm the complete shell renders without overflow.
2. Pan, zoom, reset zoom, and fit the canvas.
3. Select, drag, resize, and connect cards; confirm bearing, handles, and edges remain readable.
4. Enter and leave a sub-canvas through double-click, Open, breadcrumb, and zoom threshold.
5. Create a note and a task; edit both in the inspector.
6. Switch to Today; quick-capture, complete, and inspect task states.
7. Open task, Johnny Decimal, AI note, and provider dialogs.
8. Open and close the Balaur assistant; verify focus and inert state.
9. Export a `.canvas` file and a `.balaur.json` whole-space backup; import both paths.

### Narrow smoke check — 390 × 844

1. Confirm no horizontal clipping.
2. Open and close library and inspector sheets.
3. Reach canvas tools, Today actions, dialogs, and assistant controls by touch and keyboard.
4. Confirm Today sections stack in semantic order.
5. Confirm the map retains the majority of the viewport.

### Accessibility and motion check

1. Tab through top bar, library, canvas tools, familiar, inspector, Today, and dialogs.
2. Confirm visible focus on oak, parchment, and map surfaces.
3. Run with reduced motion and confirm instant portal/selection state changes.
4. Confirm state remains understandable without semantic colors.
5. Inspect accessible names for renamed product and assistant controls.

### Visual critique

Capture the canvas, Today, dialog, assistant, and narrow shell. Compare them with the approved Cartographer’s Tavern direction. Remove any texture, border, shadow, motif, or label that competes with node titles, task state, or primary actions.

## Acceptance criteria

- Every visible Orbit product reference becomes Balaur.
- Existing local data loads without migration.
- JSON Canvas `.canvas` import/export remains valid and unchanged.
- Whole-space export uses a `.balaur.json` filename and remains importable.
- The shell reads as carved oak, the canvas as an inked map, and nodes as parchment objects.
- Canvas node titles, types, semantic markers, selected state, and connections are easier to distinguish than in the current interface.
- Balaur bearing and familiar signatures are present but do not animate continuously.
- Today, dialogs, inspector, and assistant belong to the same material world without using fantasy control jargon.
- The application works at 1440 × 1000 and 390 × 844 without clipping or inaccessible controls.
- Keyboard focus, reduced motion, semantic labels, and color-independent state remain intact.
- No framework, OCTANT dependency, storage migration, or unrelated behavioral feature is introduced.
