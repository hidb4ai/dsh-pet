# 包含机器人完整依赖的安装包

[机器人指南](robot.md) · [English](../../en/guides/robot-bundles.md)

GitHub Actions 的 **Robot full dependency bundles** 流水线分别生成 Windows x64、Linux x64、Linux ARM64、macOS Intel 和 macOS Apple Silicon 的预览包，同时生成普通版和完整依赖版的 Windows 桌面 ZIP。本流水线不发布 npm，也不创建 GitHub Release；已发布的 `0.1.0-beta.1` 保持不变。

## 下载和安装

打开[流水线页面](https://github.com/ob-labs/dsh-pet-powercontext/actions/workflows/robot-bundles.yml)，选择成功的构建，在 **Artifacts** 下载对应的 `robot-full-<平台>`。下载需要登录 GitHub，产物保留七天。先解压下载的 artifact ZIP。

- **Windows 桌面版：**解压 `dsh-pet-win32-x64-desktop-full.zip`，保留完整的 `win-unpacked` 目录，运行 `dsh-pet.exe`。其中已经包含 Python、SDK、Electron/Node 和应用依赖。预览版未签名，Windows 可能显示信誉提示。
- **DSH 插件或 Node 独立版：**选择与**运行 DSH 的电脑**匹配的 `dsh-pet-powercontext-<版本>-<平台>-full.tgz`，不是按机器人的系统选包。在 DSH profile 的插件包目录执行 `npm install --offline --legacy-peer-deps /安装包的绝对路径.tgz`，再通过现有 profile 配置启用插件。独立版可在空目录执行该安装命令后，运行 `npx --no-install dsh-pet-powercontext`。需要 Node 22.12+；安装包不含 DSH 本身。
- **仅运行环境：**`astra-runtime-<平台>.tar.gz` 便于检查部署内容，完整插件包和桌面包已经包含它，无需重复安装。

在机器人面板选择 **内置环境（推荐）**，无需另装 Python。不要只复制 Python 可执行文件或 `bridge.py`，必须保留整个运行环境目录。升级前保存的自定义 Python 路径会保留；需要手动切换到内置环境。

## 包含哪些依赖

独立环境固定使用 CPython 3.11.18（python-build-standalone `20261110`）、Astra SDK 2.0.0、gRPC 和编译工具 1.78.0、protobuf 6.31.1、NumPy 2.4.6、厂家要求的两个 OpenCV 4.10.0.84 包，以及 pip、setuptools、typing extensions。版本和校验值放在 `dsh-pet/runtime/astra/`；生成的环境放在仓库外。完整 npm 安装包还包含桌宠的 Node 运行依赖，并标记为 private，防止误把单平台产物发布为通用 npm 包。

应用使用独立 Python 的绝对路径和隔离模式，不激活虚拟环境、不修改 PATH、不向系统 Python 安装依赖。内置文件缺失时会报错，不会悄悄切到系统 Python。Electron 中的原生文件位于 `resources/astra-runtime`，在 `app.asar` 外；插件中位于 `runtime/astra-native`。只有主动选择 **自定义 Python 环境** 才会使用指定的外部解释器。

安装包包含应用依赖，不包含操作系统。Linux 包面向 glibc，不支持 Alpine/musl；固定的 NumPy wheel 需要 glibc 2.28+，OpenCV 需要系统提供 `libGL.so.1` 和 GLib。流水线在对应架构的 Ubuntu 24.04、Windows Server 2022、macOS 15 上验证。无桌面的 Linux 可能需要执行 `sudo apt-get install libgl1 libglib2.0-0`。容器部署需要在容器内安装包和系统库。macOS 产物不是经过公证的桌面安装器。

厂家 wheel 元数据声明 MIT，但未提供独立的许可证及版权声明文件。每份运行环境保留其原始元数据和来源说明，Python 及其他依赖自带的许可证文件也会保留；后续公开分发时如能取得厂家完整声明，应一并补入。

## 构建、体积和验证

工作流合入默认分支后，可点击 **Run workflow** 并选择要构建的分支。当前开发分支 push 也会触发构建。流水线不使用 npm 凭据，也没有发布权限。

每个平台在原生 runner 上校验 Python 压缩包和 wheel 哈希，安装完整依赖并运行 `pip check`；真实导入 SDK、OpenCV contrib 和 NumPy；移动环境目录后，带着干扰性的 Python 环境变量测试隔离；通过本地模拟 gRPC 服务验证状态、单动作、动作序列、语音和三路停止。压缩包解压后会再运行测试，完整 npm 包必须能在空缓存、离线模式下安装，安装后的 HTTP 宿主还必须能自动选择内置 Python 并读取本地模拟控制器状态。

`robot-size-report` 包含 `SIZE-REPORT.md` 和各平台 JSON，列出 SHA256、压缩体积、解压后的文件体积、安装 SDK 前的 Python 体积、Node 依赖体积以及 Python 组件明细。单位为 MiB（1,048,576 字节）。OpenCV 共用文件只计一次；文件系统分配空间和安装临时空间不计入。缺少任一平台报告都会导致汇总失败。

Windows 桌面 ZIP 会解压并启动真实 Electron 应用，检查窗口加载和 ASAR 内宿主调用内置 SDK 的能力，并保存截图。展会电脑仍需现场验收，并用展会真机联调。本地模拟服务不能证明固件兼容、实际动作、播报效果或停止距离。

本机构建时，先执行 `npm pack --pack-destination /data/codex-tmp/astra-base` 生成普通包，再从 `dsh-pet` 目录运行：

```bash
TMPDIR=/data/codex-tmp PYTHONDONTWRITEBYTECODE=1 python3 scripts/astra/build.py \
  --output /data/codex-tmp/astra-full-build \
  --base-package /data/codex-tmp/astra-base/dsh-pet-powercontext-0.1.0-beta.1.tgz
```

每次构建使用新的输出目录。生成的安装包、缓存、临时环境和体积报告均不提交到仓库。
