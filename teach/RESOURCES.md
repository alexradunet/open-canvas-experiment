# Resources

## Primary (high-trust, authoritative)

### JavaScript / ES Modules
- [MDN: JavaScript Guide](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide) — canonical reference for the language
- [javascript.info](https://javascript.info/) — modern JS tutorial, excellent modules section
  - [Modules Introduction](https://javascript.info/modules-intro)
  - [Export and Import](https://javascript.info/import-export)
  - [Dynamic Imports](https://javascript.info/modules-dynamic-imports)
- [Modern Web: Going Buildless — ES Modules](https://modern-web.dev/guides/going-buildless/es-modules/) — buildless-specific module guidance

### Web Components
- [MDN: Web Components](https://developer.mozilla.org/en-US/docs/Web/API/Web_components) — canonical API reference
  - [Using Custom Elements](https://developer.mozilla.org/en-US/docs/Web/API/Web_components/Using_custom_elements)
  - [Using Shadow DOM](https://developer.mozilla.org/en-US/docs/Web/API/Web_components/Using_shadow_DOM)
  - [Using Templates and Slots](https://developer.mozilla.org/en-US/docs/Web/API/Web_components/Using_templates_and_slots)
- [Modern Web: Going Buildless — CSS](https://modern-web.dev/guides/going-buildless/css/) — shadow DOM styling, custom properties piercing

### CSS
- [web.dev Learn CSS](https://web.dev/learn/css) — evergreen course, refreshed Sept 2025 with 9 new modules (nesting, container queries, anchor positioning, popover, dialog, view transitions)
- [MDN: @layer](https://developer.mozilla.org/en-US/docs/Web/CSS/@layer) — cascade layers reference
- [GoogleChrome/modern-web-guidance: CSS](https://github.com/GoogleChrome/modern-web-guidance/blob/main/skills/modern-web-guidance/guides/css/css.md) — action-oriented modern CSS guidelines
- [MDN: CSS Scoping](https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Scoping) — shadow DOM CSS encapsulation

### Buildless Architecture
- [Modern Web: Going Buildless](https://modern-web.dev/guides/going-buildless/) — overview of buildless workflows
- [Modern Web: Going Buildless — Serving](https://modern-web.dev/guides/going-buildless/serving/) — static serving for module apps
- [Modern Web: Going Buildless — Getting Started](https://modern-web.dev/guides/going-buildless/getting-started/)

## Secondary (community, articles)

- [Designing a Style-Leak-Free Design System with @layer + @scope + Container Queries](https://devcheolu.com/en/posts/kLLfXOzZECHYcZS9gUeV) — practical architecture combining all three isolation features (2026)

## Local (in this repo)

- `AGENTS.md` — Balaur's architecture constraints and conventions
- `docs/architecture.md` — standards-first architecture
- `docs/design-system.md` — Balaur tokens, cascade layers, CSS organization
- `styles/layers.css` — live example of `@layer` ordering
- `app.js` — real-world no-build app module (large, but a reference for patterns)
- `main.js` — ordered ES-module entry point
- `storage/` — cohesive module examples with clear export contracts
