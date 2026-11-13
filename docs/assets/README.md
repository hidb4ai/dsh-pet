# Media sources / 图文来源

Only final documentation assets live here. Raw PDF extraction, capture scripts, test homes and logs stay outside the repository. 本目录只放最终文档素材，PDF 提取、截图脚本、测试目录和日志均保存在仓库外。

## Live DSH recordings / DSH 实录

Captured on **2026-11-11** in Linux Chromium, using the current `codex/bilingual-docs-refresh` working tree (based on `c62030d`), `dsh-pet-powercontext@0.1.0-beta.1`, **DSH 0.2.2-rc.1** and **PowerContext 1.5.0**. The installed plugin's built files were checked against this branch. All product views below are from the full DSH web application, with its workspace, agent session and pet plugin.

以上素材于 2026-11-11 从当前分支的完整 DSH 浏览器界面采集，保留工作区、Agent 会话和桌宠插件。安装到演示宿主的构建文件已与当前分支核对一致。

| Asset | Content / 内容 |
| --- | --- |
| `demos/dsh-chat.gif` | Send a message, receive a real reply and see the pet animate inside DSH / 在 DSH 中发送消息、接收真实回复和观看桌宠动作 |
| `demos/dsh-memory-recall.gif` | Ask again with zero recent rounds, then open the extracted memory list / 近期聊天为零轮时再次提问，并展开抽取后的记忆列表 |
| `screenshots/dsh-chat.en.png` | Full-size chat view / 原尺寸聊天截图 |
| `screenshots/dsh-facts.en.png` | Recalled answer and extracted facts / 召回回答与抽取后的事实 |
| `screenshots/dsh-sources.en.png` | Original dialogue behind a memory / 记忆关联的原始对话 |
| `screenshots/dsh-settings.en.png` | Pet settings in the same DSH session / 同一 DSH 会话中的桌宠配置 |
| `screenshots/dsh-memory.en.png` | Managed memory service ready / 已就绪的托管记忆服务 |

The project name **Moonleaf** and preference for **jasmine tea without sugar** are fictional demo inputs. DSH chat, pet chat, extraction and embeddings used the configured real provider (`qwen3.7-plus` and `qwen3.7-text-embedding`). A local forwarding proxy routed requests to that provider and allowed private request inspection; it forwarded actual provider responses, without fixtures or mocked model output. Credentials are not visible in the published captures.

Moonleaf 和“无糖茉莉花茶”是虚构演示信息。DSH 聊天、桌宠聊天、记忆抽取及 Embedding 均调用实际配置的模型服务；本地转发代理用于连接该服务并核对请求，未替换模型回复；公开素材中没有可见凭据。

After background extraction produced the project and preference memories, **Chat history rounds was set to 0** through the settings UI. The recall request contained the persona, PowerContext's prepared memories and the new question, with no earlier chat turns. The pet answered both facts correctly, and the memory list linked back to the original exchange. This demonstrates one working capture → extraction → recall flow, not a recall-quality benchmark or a restart test.

后台生成项目名与偏好记忆后，通过设置页将近期聊天设为 0 轮。实际召回请求只包含人设、PowerContext 准备的记忆和新问题，没有早先的问答；两项均回答正确，来源指向原始对话。本次展示的是一条实际跑通的采集、抽取、召回流程，不是准确率基准或重启验证。

GIFs are sampled captures of the actual browser, encoded at 1200 px width with original elapsed timing and a final-frame pause. PNGs retain the original viewport. No UI text, model answers or memory status was replaced; currently mixed-language controls are preserved. The first clip and the later recall clip are separate recordings; background processing and intervening conversation are not shown in full. Credentials, raw requests, scripts, recordings and test data remain outside this repository. Only the final documentation media is included here.

GIF 来自真实浏览器画面采样，宽度压缩为 1200 像素，保留实际时间间隔并在末帧停留；PNG 保留原始视口。未替换界面文字、模型回答或记忆状态，保留原有中英文控件。聊天和后续召回分别录制，中间的后台处理与聊天未完整展示。凭据、原始请求、脚本、原始录屏和测试数据都留在仓库外，这里只收录最终文档素材。

## Astra tutorial screenshots / Astra 教程截图

Captured on **2026-11-13** in Linux Chromium with **DSH 0.2.2-rc.1** and the Linux x64 slim package built from commit **`faa9197`**. The package was installed into a fresh DSH web profile using `dsh plugin --profile web add` with the local `.tgz`. The complete DSH interface is shown in Chinese, with a selected workspace, the pet and its chat panel.

以上截图于 2026-11-13 在 Linux Chromium 中实拍，使用 DSH 0.2.2-rc.1 和 `faa9197` 构建的 Linux x64 精简包。通过 DSH CLI 将本地包安装到全新 web profile 后采集，保留完整 DSH、工作区、桌宠与聊天面板。

| Asset | Content / 内容 |
| --- | --- |
| `screenshots/dsh-astra-panel.zh.png` | Robot controls expanded, with monitoring disabled / 展开机器人操作区，连接监测未启用 |
| `screenshots/dsh-astra-settings.zh.png` | Connection fields and bundled-runtime selection / 连接配置与内置运行环境选项 |

No model credentials, robot address or action IDs were configured. No physical robot was connected and no robot commands were sent. Interface text and state were not replaced. Only these final PNGs are committed; the temporary host, browser profile, capture commands and logs remain outside the repository.

未配置模型凭据、机器人地址或动作 ID，未连接实体机器人，也未发送机器人指令。界面文字与状态未替换。仓库只保存两张最终 PNG；临时宿主、浏览器数据、截图命令与日志均保存在仓库外。

## Supplied report / 用户提供的报告

Source: **教你如何多快好省来养大肥鱼.pdf**, 18 pages, supplied for this documentation task. SHA-256: `94d999e2c1e3d2aa321ba4242e2156a7ee18e93dc6027f5e21e84bd1961d70ef`. The PDF itself is not copied into the repository.

来源为本次任务提供的 18 页 PDF；原件不复制到仓库。以下素材直接提取，保留原图：

| Asset                                | PDF page | Meaning / 含义                                                                              |
| ------------------------------------ | -------: | ------------------------------------------------------------------------------------------- |
| `benchmarks/scale-accuracy.zh.png`   |       15 | Hits, misses and failures for 30 planned questions / 30 个计划问题的答中、未答中与失败      |
| `benchmarks/scale-usage.zh.png`      |       16 | Known generation usage including preparation and maintenance / 含整理与维护的已知生成用量   |
| `benchmarks/reuse-cost.zh.png`       |       17 | Fixed-history reuse cost curves / 固定历史的复用费用曲线                                    |

The report's setup instructions refer to an older integration commit (`ce18f9347528e47950e0c39d0097c1e180168e57`). Its screenshots are not presented as captures of the current setup wizard. Current installation commands are maintained in the bilingual installation guide.

PDF 安装部分引用旧集成提交；其中的历史界面不冒充当前设置页。当前安装命令以双语安装指南为准。

`benchmarks/reuse-summary.en.svg` is a new English plot of the PDF's stated 100-question totals: approximate known input 1.14M vs 10.26M tokens, and estimated known cost CNY 4.73 vs 6.99. It does not digitize or infer intermediate curve points. 图中的英文摘要只使用 PDF 明示的终点数值，没有推测中间点。

Read [the full English evidence](../en/explanation/memory-and-cost.md) or [中文实验说明](../zh/explanation/memory-and-cost.md) with the figures. These are historical reported experiments, not a new run, a billing receipt, or a guarantee of savings.

## Character assets / 角色素材

Character artwork and animations shown in the recordings retain the [upstream credits and terms](../../dsh-pet/ASSET-LICENSE.md). 录屏中的动画和角色素材继续遵循上游署名及授权，不因用于文档而变更许可。
