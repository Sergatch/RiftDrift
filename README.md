# RiftDrift

RiftDrift is a native macOS and Windows terminal with tabs, detachable windows, command history, custom library sections, and portable `.riftdrift` library files.

The active library is saved automatically. Use **Save as** to make a portable copy and **Open** to restore all sections and command history on another computer.

## Build the desktop app

Install dependencies once:

```bash
npm install
```

Then build the installers for the current operating system:

```bash
npm run build
```

On macOS this creates an app bundle and DMG. `npm run build:windows` creates NSIS (`.exe`) and MSI (`.msi`) installers on Windows, or cross-compiles an NSIS installer on macOS after the prerequisites in `BUILDING.md` are installed.

Windows builds can also be produced from any computer with the **Build Windows** GitHub Actions workflow. Its installers are available as a workflow artifact.

## Development

```bash
npm run dev
```

This starts the desktop frontend and opens the native RiftDrift application. The original browser prototype remains available with `npm run site:dev`.

See [BUILDING.md](BUILDING.md) for platform prerequisites, CI artifacts, signing, notarization, universal builds, and release details.
