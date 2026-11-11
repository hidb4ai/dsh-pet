# 发布版本

[English](../../en/guides/releases.md) · 简体中文 · [文档首页](../README.md)

包名为 `dsh-pet-powercontext`，初始版本 `0.1.0-beta.1`。[Release workflow](../../../.github/workflows/release.yml)对 PR 和手动运行做验证，只有推送 `v*` 标签才进入发布。

## 发布准备

1. 将需要发布的改动合并到 `master`。
2. 同步修改 `dsh-pet/package.json` 与 `openapi.yaml` 的版本，再提交并合并。首版已设置为 `0.1.0-beta.1`。
3. 需要发布 npm 时，在仓库 Actions Variables 配置 `NPM_PUBLISH=true`，Actions Secrets 配置有发布权限、适合无人值守发布的 `NPM_TOKEN`。不要把令牌提交到 `.npmrc`。没有开启变量时，只发布 GitHub Release 和桌面产物。
4. 从准备发布的提交推送匹配标签：

```sh
git switch master
git pull --ff-only origin master
git tag v0.1.0-beta.1
git push origin v0.1.0-beta.1
```

后续版本使用新的版本号和标签。流程只校验已提交版本，不会临时改版本。

## 自动执行顺序

| 阶段                | 内容                                                             |
| ------------------- | ---------------------------------------------------------------- |
| 校验                | 包名、版本、标签完全一致                                         |
| 构建                | 按锁文件安装依赖，跑单测和完整 `npm pack` 发布前检查             |
| 验证                | Chromium UI / 脚本测试，实装归档并检查 CLI `--help` / `--check`  |
| 保存产物            | 生成 SHA256SUMS，上传已测试安装包为 Actions artifact，保留 14 天 |
| 可选 npm 发布       | 核对校验和，发布同一份归档，不再执行包内生命周期脚本             |
| 创建 GitHub Release | 自动生成说明，附上归档和校验文件                                 |
| 桌面构建            | 调用 Windows workflow，将 `dsh-pet-win-x64.zip` 挂到同一 Release |

`alpha.N`、`beta.N`、`rc.N` 分别使用对应 npm 通道，并创建 GitHub 预发布；正式版本使用 `latest`。PR 和 **Run workflow** 即使选择标签也不会发布。

## 失败后怎样处理

构建或测试失败会停止发布。开启 npm 后，npm 失败会阻止创建 GitHub Release。之后 Windows 构建失败，不会回滚已经发布的 npm 和 Release；可以手动运行 `release-app`，填写原标签补传 ZIP。

npm 已发布的版本不能覆盖。如果 npm 已成功、后续步骤失败，不能假设重跑整个流程会自动跳过 npm，目前没有这项恢复逻辑。先确认哪些产物已经存在，再选择重试步骤。修改安装包内容后使用新版本。

## 本地检查安装包

在内层包目录运行 `npm pack --pack-destination /仓库外的绝对目录`，会执行完整 prepack 检查。归档、冒烟安装目录和日志留在仓库外；本机 Linux 使用 `/data/codex-tmp/` 并设置 `TMPDIR`。
