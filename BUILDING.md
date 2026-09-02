# Building RiftDrift

Install the shared prerequisites first:

- Node.js 22.13 or newer
- Rust 1.77.2 or newer

Then install the JavaScript dependencies:

```bash
npm ci
```

## Linux

Linux packages must be built on Linux. On Debian 12 or Ubuntu 22.04 and newer, install the Tauri system dependencies:

```bash
sudo apt update
sudo apt install libwebkit2gtk-4.1-dev \
  build-essential \
  curl \
  wget \
  file \
  libxdo-dev \
  libssl-dev \
  libayatana-appindicator3-dev \
  librsvg2-dev \
  patchelf
```

Then build all supported Linux package formats:

```bash
npm run build:linux
```

Artifacts:

- `src-tauri/target/release/bundle/appimage/RiftDrift_*.AppImage`
- `src-tauri/target/release/bundle/deb/RiftDrift_*.deb`
- `src-tauri/target/release/bundle/rpm/RiftDrift-*.rpm`

The AppImage is the most portable option. Make it executable before launching it:

```bash
chmod +x RiftDrift_*.AppImage
./RiftDrift_*.AppImage
```

Linux binaries depend on the glibc version of the build system. The GitHub Actions build therefore uses Ubuntu 22.04 as a stable compatibility baseline instead of `ubuntu-latest`.

## Windows

### Native Windows build

Install the Microsoft C++ Build Tools with the **Desktop development with C++** workload and Microsoft Edge WebView2, then run:

```powershell
npm run build:windows
```

Artifacts:

- `src-tauri/target/release/bundle/nsis/RiftDrift_*-setup.exe`
- `src-tauri/target/release/bundle/msi/RiftDrift_*.msi`

MSI installers can only be built on Windows.

### Cross-build from macOS

Tauri supports cross-compiling an x64 NSIS `.exe` installer from macOS. Install the prerequisites once:

```bash
brew install nsis llvm
rustup target add x86_64-pc-windows-msvc
cargo install --locked cargo-xwin
```

Then use the same command:

```bash
npm run build:windows
```

Artifact:

- `src-tauri/target/x86_64-pc-windows-msvc/release/bundle/nsis/RiftDrift_*-setup.exe`

The cross-build script checks the prerequisites and automatically adds Homebrew's LLVM directory to `PATH`.

The generated installers are unsigned. Windows may show a SmartScreen warning until the executable and installers are signed with a trusted code-signing certificate.

## macOS

## Local DMG

The default build is ad-hoc signed and is intended for local installation and testing:

```bash
npm run build:mac
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
npm run build:mac
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

## GitHub Actions releases

The repository includes a **Build Installers** workflow that builds Linux x64 AppImage/DEB/RPM packages, Windows x64 NSIS/MSI installers, and a universal macOS DMG for Apple Silicon and Intel.

Run the workflow manually from the Actions tab to produce temporary `RiftDrift-Linux-x64`, `RiftDrift-Windows-x64`, and `RiftDrift-macOS-Universal` artifacts. Push a tag matching `v*` to publish all packages in a permanent GitHub Release with automatically generated release notes.

The macOS CI build is ad-hoc signed. It is suitable for local installation, but Gatekeeper may warn users because the app is not signed with a Developer ID certificate or notarized by Apple.

## Versions

Before a release, update the version in all three files:

- `package.json`
- `src-tauri/Cargo.toml`
- `src-tauri/tauri.conf.json`
