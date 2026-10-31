# Single-player build

Bundles the server into one script, `sp/server.bundle.js`, for an embedded QuickJS host (the PS Vita client).

Build from the engine root:

```
npm install
npm install --no-save esbuild@0.28.2
node sp/build.mjs
```

Content: LostCityRS/Content branch `225`, commit `9901aa27`.
