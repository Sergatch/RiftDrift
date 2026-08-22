# RiftDrift

RiftDrift is a native macOS terminal with tabs, detachable windows, command history, custom library sections, and portable `.riftdrift` library files.

The active library is saved automatically. Use **Save as** to make a portable copy and **Open** (or open the registered `.riftdrift` file in Finder) to restore all sections and command history on another Mac.

## Build a DMG

Install dependencies once:

```bash
npm install
```

Then build the macOS installer with one command:

```bash
npm run build
```

The DMG is written to `src-tauri/target/release/bundle/dmg/`.

## Development

```bash
npm run dev
```

This starts the desktop frontend and opens the native RiftDrift application. The original browser prototype remains available with `npm run site:dev`.

See [BUILDING.md](BUILDING.md) for signing, notarization, universal builds, and release details.
