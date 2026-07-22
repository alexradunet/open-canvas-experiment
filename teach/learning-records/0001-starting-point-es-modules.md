# 0001 — Starting point: ES Modules as foundation

## Status
Accepted

## Context
User is intermediate JS (framework experience, platform fuzzy). Building Balaur, a no-build vanilla JS app. The platform underneath frameworks is the gap.

## Decision
Start the curriculum with ES Modules because:
1. They are the literal replacement for the bundler — the single biggest conceptual shift for a framework developer going buildless
2. Balaur's entire architecture is a module graph rooted at `main.js`
3. Everything else (Web Components, CSS architecture, platform APIs) builds on top of a well-understood module system

## Curriculum arc (initial)
1. ES Modules (foundation) ← we are here
2. Module architecture (organizing a no-build app)
3. Web Components: custom elements
4. Web Components: shadow DOM and styling
5. Modern CSS: cascade layers and @scope
6. Modern CSS: container queries and :has()
7. Platform state: IndexedDB and storage patterns
8. Service Workers and offline
9. Rendering without a framework (DOM strategies)
10. Architecture patterns (events, repositories, projections)

## Consequences
- Lessons should reference Balaur's actual code as living examples
- Each lesson ties back to "what framework problem does this replace?"
- User's framework mental models are assets to build on, not obstacles
