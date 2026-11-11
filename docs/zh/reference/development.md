# 开发与验证

[English](../../en/reference/development.md) · 简体中文 · [文档首页](../README.md)

## 源码地图

| `dsh-pet/` 下的路径    | 职责                                 |
| ---------------------- | ------------------------------------ |
| `src/host/`            | 插件装配、配置、路由、队列与宿主服务 |
| `src/client/`          | 角色、设置与聊天界面                 |
| `src/shared/`          | 类型、动画与交互规则                 |
| `src/standalone/`      | 独立服务、模型设置与本机记忆         |
| `src/app/`、`runtime/` | 应用与 Electron 外壳                 |
| `scripts/`             | 构建、打包与浏览器检查               |
| `assets/`              | 配置及角色素材                       |

根目录包含双语 `docs/`、OpenAPI 契约、发布 workflow 和素材制作工具；内层包是 npm 的发布单元。

## 验证改动

使用 Node.js 24 和 pnpm 10.34.3，与发布流程一致。在 `dsh-pet/` 中运行：

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm typecheck
pnpm lint
pnpm format:check
pnpm check:cycles
pnpm check:runtime
pnpm check:openapi
pnpm test
pnpm build
pnpm exec playwright install chromium
pnpm test:ui
```

Linux CI 缺少系统依赖时，使用 `playwright install --with-deps chromium`。单测与浏览器 / 脚本测试分别运行；浏览器测试使用本地替身，不读取个人 DSH 配置或调用真实模型。UI 测试通过不代表验证了原生桌面点击穿透、显示缩放、麦克风硬件或实际 npm 发布。

`npm pack --pack-destination /仓库外的绝对目录` 会运行完整 prepack。还应把归档安装到独立用户目录，验证分发后的行为，而不只验证源码导入。

日志、测试用户目录、PDF 原始提取和临时截图放在仓库外。本机 Linux 使用 `/data/codex-tmp/` 并设置 `TMPDIR`。只有最终审阅过的文档图片进入 `docs/assets/`。

## 维护双语文档

英文和中文页面在 `docs/en/`、`docs/zh/` 中使用相同路径，每页提供语言切换和文档首页链接。教程写跟做步骤，指南解决具体问题，参考文档供查参数，原理说明解释机制与证据。

源码注释、测试描述、日志和诊断信息使用英文。明确的双语资料及中文本地化继续保留在对应文件中。

行为变化时同步两种文档，来源 ID、文件名和专有名称保持准确。`prompts/` 中的原始中文内容是角色素材生成输入，与原始素材名称一起保留。保留本地化字典及验证中文 / Unicode 行为的测试内容。截图注明运行方式、版本和是否使用合成内容；实验图注明对照、分母、缺失数据和计价日期，不把 token 节省直接等同于费用节省。

根目录旧文档作为已分享链接的导航入口，详细内容集中在 docs，避免重复维护。中英文包 README 指向同一套指南。

## 反馈问题

附上提交 / 版本、操作系统、运行方式（DSH 浏览器 / 桌面或独立模式）、预期与复现步骤。去掉 API Key、带凭据的访问地址和私人对话。区分宿主未提供某项能力与已经支持的功能发生故障。
