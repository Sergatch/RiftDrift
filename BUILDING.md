# Building RiftDrift for macOS

## Local DMG

The default build is ad-hoc signed and is intended for local installation and testing:

```bash
npm run build
```

Artifact:

- `src-tauri/target/release/bundle/dmg/RiftDrift_*.dmg`

To keep both the unpacked application and DMG, use:

```bash
npm run build:mac
```

This also creates `src-tauri/target/release/bundle/macos/RiftDrift.app`.

Run all desktop checks without creating a release bundle:

```bash
npm run check:desktop
```

## Development build

```bash
npm run dev
```

The development command starts Vite automatically and launches the native Tauri window. The terminal backend runs the user's login shell in a real PTY.

## Signed distribution

To distribute the DMG to other users without a Gatekeeper warning, install a `Developer ID Application` certificate and expose its exact Keychain identity for the build:

```bash
export APPLE_SIGNING_IDENTITY="Developer ID Application: Your Name (TEAMID)"
npm run build
```

Tauri can notarize the same build when Apple credentials are present. Use either an App Store Connect API key (`APPLE_API_ISSUER`, `APPLE_API_KEY`, `APPLE_API_KEY_PATH`) or Apple ID credentials (`APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID`). Never commit these values to the repository.

## Universal Apple Silicon + Intel build

Install both Rust targets once:

```bash
rustup target add aarch64-apple-darwin x86_64-apple-darwin
```

Then run:

```bash
npx tauri build --target universal-apple-darwin --bundles dmg
```

## Versions

Before a release, update the version in all three files:

- `package.json`
- `src-tauri/Cargo.toml`
- `src-tauri/tauri.conf.json`
