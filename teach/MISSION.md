# Mission

## Why

I want to build my own applications using only the web platform — no bundlers, no frameworks, no build pipelines. I've built things with frameworks before, but the platform underneath is fuzzy. I want to understand what the browser actually gives me natively, so I can build with confidence and without tooling overhead.

## Context

I am actively building **Balaur** — a local-first life-management app that is a static site: native strict ES modules, vanilla JavaScript, Web Components, plain CSS with cascade layers, no package install, no build step, no CDN dependency, no UI framework. This learning directly serves that project.

## What success looks like

- I can architect a non-trivial app using only ES modules, Web Components, and modern CSS
- I understand *why* each platform feature exists and what framework problem it replaces
- I can read and write idiomatic modern JS/CSS without reaching for a transpiler
- I can make informed decisions about when the platform is enough vs. when tooling earns its place

## Scope

- Modern ES (ES2020+): modules, async patterns, iterators, proxies, structured clone
- Web Components: custom elements, shadow DOM, templates, slots, adopted stylesheets
- Modern CSS: cascade layers, `@scope`, container queries, `:has()`, nesting, custom properties, `light-dark()`
- Platform APIs: IndexedDB, Service Workers, Intersection Observer, Pointer Events, History API
- Architecture patterns for no-build apps: module organization, state management, rendering strategies
