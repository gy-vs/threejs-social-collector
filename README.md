# Three.js 社媒 Showcase 采集

当前规则版本：1.2。核验日期：2026-10-19。

## 可迁移抓取项目

- [抓取规范.md](抓取规范.md)：跨电脑运行所需的目标表、字段、查重、并行策略和写入流程。
- [rule.md](rule.md)：不可放宽的 R1-R9 质量红线。
- [统计数量.md](统计数量.md)：以“写入飞书成功数量”为核心的运行台账。
- [scripts/feishu-sync.mjs](scripts/feishu-sync.mjs)：查重、串行写入、Record ID 回写和跨电脑汇总。
- [config/collector.json](config/collector.json)：非敏感的飞书目标配置；凭证使用本机 `lark-cli` profile。

在新电脑上先安装 Node.js 20+ 和 `lark-cli`，配置名为 `codex-base-writer` 的可用 Feishu bot profile，然后让 Codex 读取 `抓取规范.md` 和 `rule.md`。项目不把 OAuth token 或 App Secret 提交到 GitHub。

- [rule.md](rule.md)：不可违背的准入规则，已纳入用户补充的质量、平台、时间、主体性与负例。
- [reference-audit.md](reference-audit.md)：三个参考案例的源码、对应关系、许可与未核事项。
- [first-10.md](first-10.md)：本轮 10 条已完成媒体画面审阅的作品，含社媒/仓库、主体源码证据、技术标签、媒体时间点、质检结论、版本及许可边界。
- [first-10-review-v1.2.md](first-10-review-v1.2.md)：结合飞书 Base 现有数据和审核员口径，对首批 10 条的规则复审结果。
- [batch-2.md](batch-2.md)：第二批 5 条作品审阅记录，包含 Wind Waker、Roadster、Kokraf、world.execute 和 TSL Slug Text。
- [accepted-all.md](accepted-all.md)：当前全部 accepted 记录的社媒、仓库、主体核验、视觉质检和许可边界总清单。
- [collection.md](collection.md)：初轮 6 条采集的历史快照，已被本轮清单取代。
- [collection.json](collection.json)：结构化记录。`accepted` 才是正式导入集，`pending` 与 `rejected` 不得导入。

当前正式清单 **15 条已全红线通过**。每条的社媒关联、核心源码、Three.js 主体性和实际媒体画面均已逐条核实，R5/R9 结论基于视频或帖子中的具体时间点/画面。没有部署运行，没有实测性能。

总账为 15 条已通过、2 条待核验、4 条淘汰/负例。2 条待核验是 Wave-Racer 和 Three.js Quake，仍只作历史审计保留；4 条淘汰/负例包括用户提供的 3 条，以及实际已移除 Three.js 主体的 Tidewater。

## 本地校验

需要 Node.js 20 或更新版本，无第三方依赖：

```sh
node scripts/validate.mjs
node --test scripts/validate.test.mjs
```

校验器只检查记录结构和准入状态，包括红线是否全通过、公开社媒具体帖子、源码证据、主体性标记、媒体审阅记录、日期、用户负例与重复仓库。它不访问网络，不能证明人工填写的判断真实，也不代替源码阅读、媒体审阅或实际质量判断。

## 后续验收

当前 15 条已完成实际媒体审阅并写入 `accepted`；飞书已同步首批 8 条和第二批新增 2 条，Roadster 因表内已有相同社媒/仓库记录而跳过。仍需保留“未部署运行、未实测性能”的边界；视频里展示的交互只按可见内容记录，不扩展成运行验证结论。`pending` 中的历史候选不得混入正式表。

飞书信息暂不需要提供，本阶段只保留本地结果。
