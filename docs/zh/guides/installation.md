# 安装 dsh-pet-powercontext

[English](../../en/guides/installation.md) · 简体中文 · [文档首页](../README.md)

## 选择运行方式

| 方式             | 适合什么情况                | 要求                                   |
| ---------------- | --------------------------- | -------------------------------------- |
| DSH 浏览器版     | 已经在使用 DeepSeek Harness | DSH 0.2.2-rc.1，CLI 需要 Node.js 24.9+ |
| DSH 桌面版       | 使用 DSH 桌面应用           | 安装到 `desktop` profile               |
| 独立模式         | 不打开 DSH，只养桌宠        | Node.js 22.12+，配置聊天模型           |
| Windows 桌面 ZIP | 希望解压后启动应用          | 对应 Release 已提供 Windows x64 ZIP    |

从源码开发可统一使用 Node.js 24。透明桌宠窗口需要图形桌面和 Electron；无桌面机器可使用独立模式的浏览器设置与聊天页面。本机 PowerContext 自动安装支持 Linux/macOS，Windows 记忆安装仍为实验性支持。

## 安装已发布的包

下列命令要求版本已经发布。如果 npm 提示找不到包，先使用后面的源码或安装包方式。

```sh
# DSH 浏览器版
dsh plugin --profile web add dsh-pet-powercontext@beta

# DSH 桌面版
dsh plugin --profile desktop add dsh-pet-powercontext@beta

# 独立模式首次设置
npx dsh-pet-powercontext@beta --setup
```

启用前先停用上游 `dsh-pet` 插件，两者共用路由、命令和 `$DSH_HOME/dsh-pet/` 数据目录。保留该目录即可保留配置和记忆。安装或更新宿主插件后重启 DSH。

## 从源码安装

```sh
git clone --branch master https://github.com/ob-labs/dsh-pet-powercontext.git
cd dsh-pet-powercontext/dsh-pet
pnpm install --frozen-lockfile --ignore-scripts
pnpm build
pnpm standalone --setup
```

打开终端提示的本机设置地址。没有自动打开浏览器时，在宿主机器的 `$DSH_HOME/dsh-pet/standalone-runtime.json` 中读取 `settingsUrl`；未设置 `DSH_HOME` 时默认使用 `~/.dsh`。这个地址含有私有访问凭据，仅在本机打开，不要分享。

需要独立桌面窗口时，在同一包目录执行：

```sh
pnpm ensure:electron
pnpm start:app
```

需要装进 DSH 时，改用：

```sh
# Linux/macOS，在内层包目录执行。
dsh plugin --profile web add "file:$PWD"
# Windows 示例：
# dsh plugin --profile web add file:C:/projects/dsh-pet-powercontext/dsh-pet
```

DSH 桌面版改用 `--profile desktop`。重启 DSH，打开「设置 → 桌宠配置」，继续阅读[养好第一只桌宠](../tutorials/first-pet.md)。

## 安装 tgz 归档

将归档输出到仓库外已经存在的目录：

```sh
# 在内层包目录执行。
npm pack --pack-destination /absolute/path/to/packages
dsh plugin --profile web add /absolute/path/to/packages/dsh-pet-powercontext-0.1.0-beta.1.tgz
```

反复构建本地包时使用不同文件名，避免 DSH 命中本地安装包缓存。下载 Release 产物后，可对照 `SHA256SUMS` 检查文件完整性。

## Windows 桌面 ZIP

打开 [Releases](https://github.com/ob-labs/dsh-pet-powercontext/releases)，选择需要的版本，下载该版本的 `dsh-pet-win-x64.zip`。预发布版本不一定出现在 latest 页面。完整解压到可写目录，再运行其中的程序；不要把可执行文件单独移走。这个 ZIP 是应用目录，既不是 npm 包，也不是安装向导。

在应用的 AI 设置中配置聊天。长期记忆需要另行准备环境，可能下载依赖；下载 ZIP 不代表已安装 PowerContext。若 Release 尚无 ZIP，查看对应 Windows workflow 或使用源码方式。

## 更新与卸载

把需要的版本安装到同一 DSH profile 后重启。让 DSH 管理记忆目录前，先退出使用同一目录的独立进程。

```sh
dsh plugin --profile web remove dsh-pet-powercontext
```

卸载插件和删除数据是两件事。不打算删除配置和记忆时，请保留用户目录。详见[记忆管理](memory.md#删除与停用)。
