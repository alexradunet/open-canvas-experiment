# Historical SQLite provenance

This directory retains the official SQLite Wasm module that was evaluated by an earlier prototype. Canonical-files-only v1 does not load SQLite at runtime: `.canvas`, Markdown, and the workspace sidecar are canonical, while the browser rebuilds an in-memory query index from those files.

- Package: `@sqlite.org/sqlite-wasm`
- Version: `3.53.0-build1`
- Source: https://www.npmjs.com/package/@sqlite.org/sqlite-wasm
- Upstream: https://sqlite.org/wasm/
- License: Apache License 2.0 (`LICENSE`)

Vendored files:

- `sqlite3.mjs` — `dist/index.mjs`
- `sqlite3.wasm` — `dist/sqlite3.wasm`

SHA-256 at import:

```text
f80870f0fa03a39a3338d17ed3fbea04808d344c88e724d90d5f37b9b7b83154  sqlite3.mjs
02d7e48164395fa68f81c6ec33e9da5461be397dc57602ac0cd89b4bbba1d312  sqlite3.wasm
```

A future persistent index may use SQLite behind the same projection boundary, but it is not a v1 dependency. OPFS-backed SQLite Wasm would require COOP/COEP headers that GitHub Pages cannot configure; any such optimization must remain rebuildable from canonical vault files.
