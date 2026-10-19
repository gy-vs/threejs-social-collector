# Three.js 社媒 Showcase 采集

规则版本：1.3。当前执行范围已于 2026-10-19 获用户确认：持续发现，不设采集数量上限；R1-R9 全部通过一条即写入指定飞书表一条，取得成功 Record ID 后立即更新 `统计数量.md`。

## 执行入口

- `抓取规范.md`：目标表、字段、先查重后质检、单 writer 和逐条写入流程。
- `rule.md`：不可放宽的 R1-R9 红线、教程投稿排除及验收反馈。
- `acceptance-feedback-2026-10-19.json`：4条验收拒收、教程排除及原帖偏好评论的逐条依据。
- `config/rejected-cases.json`：固定否决案例索引。
- `统计数量.md`：从0开始的本机成功数量、运行障碍及 Record ID。
- `runs/`：各机自己的候选、审核证据和写入回执目录；本次规则发布不包含运行数据。
- `config/collector.json`：非敏感目标配置。凭证由本机官方 CLI 管理，不提交仓库。

仓库不包含旧 README 提到的 `collection.json`、`accepted-all.md` 等历史文件，不把旧文档中声称的已通过条目当成本轮核验结果。首次迁移到新电脑时，应先将本机台账从0初始化；已有本机运行记录的电脑保留自己的累计。其他机器的历史写入不计入本机成果，远端表继续作为去重依据。

## 校验与写入

需要 Node.js 20+。校验命令检查当前实际存在的文件，并执行离线写入器测试，不访问飞书，不代替人工质检：

```sh
npm run validate
node scripts/feishu-sync.mjs --input candidates.json --dry-run
node scripts/feishu-sync.mjs --input candidates.json
node scripts/feishu-sync.mjs --aggregate-only
```

输入使用 `candidates.example.json` 的字段结构；本地 `_review` 必须记录1.3版审核、showcase投稿性质、R1-R9全通过及真实媒体观察。写入时剥离 `_review`，不把内部审核元数据作为飞书字段。示例本身未审阅，不得写入。每条的源码、固定 commit、原帖对应关系、发布时间、视觉观察及许可边界必须保留在本地审核材料和相关备注中。

写入器优先使用 `THREEJS_LARK_CLI` 指定的可执行文件、项目运行目录的 `.runtime/lark/node_modules/.bin/lark-cli`，最后尝试 PATH 中的 `lark-cli`。每台电脑需要安装官方 CLI，并单独配置名为 `codex-base-writer` 的可用 bot profile；Git 仓库不携带本机登录态。读权限通过目标表字段和记录读取验证，实际创建权限以首条合格案例写入返回的 Record ID 为准。

每次只创建 1 条；质检前先读取采集目标表和验收反馈表查重，每条写入前再次刷新两个索引，本机以锁文件保证单 writer。成功后立即记录 ID 并原子更新统计。任何身份、字段或网络错误均停止创建；结果不明时先对账，不能盲目重发。两台电脑共享同一目标时只启用一个 writer。

## 本机应用配置

没有可用应用时，可在官方飞书页面完成应用配置。在已安装项目本地 CLI 的目录执行：

```sh
.runtime/lark/node_modules/.bin/lark-cli config init --new --name codex-base-writer --lang zh
```

已有应用时使用 `config init --name codex-base-writer --app-id <AppID> --app-secret-stdin --brand feishu`，通过stdin传入App Secret，避免放入命令参数。已有同名可用profile时直接使用，无需重新配置。运行日志位于忽略目录 `.runtime/writer-events.ndjson`；本机台账及 `runs/` 运行数据不随本次规则发布。不要将令牌、App Secret 或个人凭证写入项目。
