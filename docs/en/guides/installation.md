# Install dsh-pet-powercontext

English · [简体中文](../../zh/guides/installation.md) · [Documentation](../README.md)

## Choose a runtime

| Runtime             | Use it when                                 | Requirements                                       |
| ------------------- | ------------------------------------------- | -------------------------------------------------- |
| DSH web             | You already work in DeepSeek Harness        | DSH 0.2.2-rc.1; Node.js 24.9+ for its CLI          |
| DSH desktop         | You use the DSH desktop application         | Install into the `desktop` profile                 |
| Standalone          | You want a pet without DSH                  | Node.js 22.12+; a configured chat provider         |
| Windows desktop ZIP | You prefer an extracted desktop application | A Windows x64 ZIP attached to the selected release |

Node.js 24 is a convenient common version for source development. Graphical pets require a desktop session and Electron; headless machines can use the standalone web settings and chat pages. Automatic local PowerContext installation supports Linux/macOS; Windows memory installation remains experimental.

## Install a published package

These commands require the version to have been published. If npm cannot find it, use the source or archive instructions below.

```sh
# DSH browser profile
dsh plugin --profile web add dsh-pet-powercontext@beta

# DSH desktop profile
dsh plugin --profile desktop add dsh-pet-powercontext@beta

# Standalone setup
npx dsh-pet-powercontext@beta --setup
```

Disable the upstream `dsh-pet` plugin before enabling this package. Both use the same routes, commands and `$DSH_HOME/dsh-pet/` directory. Retain that directory to keep configuration and memories. Restart DSH after installing or updating a host plugin.

## Build from source

```sh
git clone --branch master https://github.com/ob-labs/dsh-pet-powercontext.git
cd dsh-pet-powercontext/dsh-pet
pnpm install --frozen-lockfile --ignore-scripts
pnpm build
pnpm standalone --setup
```

Follow the local setup URL. If no browser opens, read `settingsUrl` from `$DSH_HOME/dsh-pet/standalone-runtime.json` on the host machine (`DSH_HOME` defaults to `~/.dsh`). The URL contains a private capability: open it locally and do not share it.

For the graphical standalone app, run these commands from the same package directory:

```sh
pnpm ensure:electron
pnpm start:app
```

To use the source build in DSH instead:

```sh
# Linux/macOS; run inside the inner package directory.
dsh plugin --profile web add "file:$PWD"
# Windows example:
# dsh plugin --profile web add file:C:/projects/dsh-pet-powercontext/dsh-pet
```

Use `--profile desktop` for the DSH desktop app. Restart that DSH process, then open **Settings → Pet Config**. See [Your first pet](../tutorials/first-pet.md).

## Install an archive

Build an archive outside the checkout:

```sh
# From the inner package directory; choose an existing directory outside the repository.
npm pack --pack-destination /absolute/path/to/packages
dsh plugin --profile web add /absolute/path/to/packages/dsh-pet-powercontext-0.1.0-beta.1.tgz
```

Use a distinct filename for each rebuilt local archive; the DSH installer can cache local file packages. Verify a release download against its `SHA256SUMS` file.

## Windows desktop ZIP

Open [Releases](https://github.com/ob-labs/dsh-pet-powercontext/releases), select the intended version, and download `dsh-pet-win-x64.zip` if present. A prerelease may not appear under “latest”. Extract the complete archive to a writable directory, then launch the executable inside. Keep its neighboring files together. The ZIP is an application bundle, not an npm package or an installer wizard.

Use the app's AI settings to configure chat. Memory preparation is a separate step and may need network downloads; the ZIP does not mean PowerContext is already installed. If the ZIP is absent, check the release's Windows workflow or use the source route.

## Update and remove

Install the desired version into the same DSH profile and restart it. Stop a standalone process before having DSH manage the same memory directory.

```sh
dsh plugin --profile web remove dsh-pet-powercontext
```

Removing the plugin and deleting your data are separate actions. Keep the user data directory unless you intend to remove configuration and memories. See [memory controls](memory.md#deletion-and-disabling).
