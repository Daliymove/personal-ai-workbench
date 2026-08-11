# Personal AI Workbench

一个本地优先、直接读取 Obsidian 风格 Markdown Vault 的个人 AI 工作台。本目录只保存应用代码；示例知识库位于旁边的 `../个人知识库/`。

Workbench 提供可复用的读取、索引和可视化能力，不包含任何作者的个人知识、账号数据、登录态或历史运行记录。仓库级 `个人知识库/` 是完全虚构的演示 Vault，用于展示素材阅读、Wiki、知识星图、灵感、内容与抖音数据页面。

## 当前公开范围

已包含：

- 本地 Vault 总览与实时索引
- Wiki 列表与知识星图
- 素材阅读、书架、笔记与本地搜索
- 每日热点（AI HOT 公共匿名 API）
- 社媒洞察的本地只读展示
- 灵感库与内容中心
- 抖音数据面板及完整数据模板

暂不公开展示：

- Brainstorm 执行功能
- `90_runs/` 运行档案
- 微信公众号账号面板

这些模块在原始个人实例中依赖特定 Skill、私有策略或账号数据，不能被包装成开箱即用的公共能力。

## 快速开始

环境要求：Node.js 22 或更新版本。

```bash
npm install
npm run dev
```

默认读取 `../个人知识库/`。浏览器打开终端输出中的本地地址即可查看演示。

### 连接自己的 Vault

复制环境变量示例并填写绝对路径：

```bash
cp .env.example .env
```

```text
PERSONAL_DASHBOARD_VAULT_ROOT=/absolute/path/to/your-vault
```

重启开发服务器后生效。建议先备份自己的 Vault；公开版默认仍只监听 `127.0.0.1`。

## 建议的 Vault 结构

```text
your-vault/
├── 10_raw/                 # 原始材料
├── 30_self_media/douyin/   # 可选：抖音固定数据层
├── 40_topics/ideas/        # 灵感
├── 50_scripts/             # 内容成果
└── wiki/
    ├── concepts/           # 概念
    └── frameworks/         # 框架
```

Workbench 可以索引其他文件，但示例版只承诺上述公开结构。不存在的字段不会被虚构为 `0`。

## 默认策略与个人覆盖

每日热点使用 `config/attention.default.json` 中的中性默认关注域。要定制时：

```bash
cp config/attention.local.example.json config/attention.local.json
```

修改 `attention.local.json` 后重启服务器。这个文件已被 Git 忽略，适合保存个人关注词；不要把私人客户名、项目名或内部策略提交到公共仓库。

## 抖音数据

- 可运行演示：`../个人知识库/30_self_media/douyin/current.json`
- 字段模板：`templates/douyin/current.template.json`
- 契约说明：`templates/douyin/README.md`

所有示例标题、账号指标、作品 ID 和时间序列均为人工虚构，并在数据中标记 `demoMode: true`。

演示数据覆盖账号 30 日趋势、作品月度分布、合集、累计快照、小时生命周期、留存、跳出、涨粉、流量来源、搜索词和受众维度。需要重新生成时执行：

```bash
npm run demo:generate
```

## 隐私边界

公开前请执行：

```bash
npm run privacy:scan
```

扫描不会代替人工审核。还需要检查 Git 历史、图片、录屏、测试夹具、构建产物和本地配置。详细清单见 [公开边界说明](docs/public-release-boundaries.md)。

## 许可证

代码许可证尚未由版权所有者确认。在明确选择许可证之前，不应把仓库对外宣称为已完成法律意义上的开源发行。
