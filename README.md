<p align="center">
  <img src="./docs/images/readme/hero.svg" width="100%" alt="Personal AI Workbench：一个本地优先、Agent 可调用的个人知识工作台。">
</p>

# Personal AI Knowledge Workspace

一个本地优先、可被 AI Agent 调用并持续维护的个人知识库，以及它的可视化 Workbench。

它把 Raw 素材、Wiki 知识、阅读、灵感、内容生产、社媒研究和账号数据放进一套可读的 Markdown 目录中；Workbench 负责索引、搜索、阅读和图表展示。公开仓库只包含 synthetic demo，不包含作者的真实知识库或账号数据。

## 能做什么

- 用 Markdown 和 Obsidian 管理个人知识库，不绑定专有数据库。
- 在 Workbench 中查看 Raw、Wiki、知识关系、书架、灵感和内容状态。
- 展示脱敏的近期社媒风向与主题研究报告。
- 展示本人抖音创作者中心的作品、账号趋势、合集、留存和观众分析数据。
- 将需要推理或登录态的任务交给用户自己的 Codex、Claude Code 或其他 Agent。
- 所有真实内容和登录态都留在用户本机。

## 界面预览

<p align="center">
  <img src="./docs/images/readme/showcase.png" width="100%" alt="Personal AI Workbench 功能总览：总览、每日热点、社媒洞察与抖音数据页面的层叠预览。">
</p>

主图展示 Workbench 的核心浏览路径。总览、社媒洞察与抖音账号数据均使用仓库内明确标注的 synthetic demo；每日热点来自截图时的公开匿名 API。

### 社媒洞察

![社媒洞察页面：近期风向与主题档案](./docs/images/readme/social-insights.png)

### 抖音数据

![抖音数据页面：账号概览、趋势、合集与内容分布](./docs/images/readme/douyin-insights.png)

## 目录结构

```text
person_dashboard/
├── 个人知识库/   # 独立的 Markdown Vault 与 synthetic demo 数据
├── Workbench/    # 前端、服务端、测试、模板和开发工具
├── README.md
└── LICENSE
```

两层可以独立理解：

- `个人知识库/` 保存 Raw、Wiki、灵感、内容成果和抖音数据契约，可以直接用 Obsidian 或其他 Markdown 工具打开。
- `Workbench/` 不内置个人内容；默认读取旁边的 `个人知识库/`，也可以通过环境变量连接其他 Vault。

## 怎么使用

推荐把这个仓库直接交给支持代码和终端操作的 AI Agent，例如 Codex、Claude Code 或 WorkBuddy。让 Agent 负责克隆、安装依赖、启动项目和处理后续的数据适配，你只需要把目标和数据需求讲清楚。

```text
请打开这个仓库，先阅读 README 和 AGENTS.md，然后安装依赖并运行项目。
先使用仓库自带的 synthetic demo，确认总览、知识星图、社媒洞察和抖音数据页面可以正常打开。
```

项目要求 Node.js 20+。Agent 最终执行的基础命令是：

```bash
cd Workbench
npm install
npm run dev
```

### 接入自己的知识库

仓库默认读取旁边的 `个人知识库/`，这既是一套 synthetic demo，也是一份前台数据契约示例。把环境变量指向另一个 Vault，并不代表任意目录都能自动匹配当前页面。

Workbench 的每个页面都期待特定的目录、字段和数据含义。接入自己的知识库前，需要先让 Agent 理解前台展示什么、服务端如何索引、现有模板要求哪些字段，再建立你的数据与这些接口之间的映射。字段或口径对不上时，页面应保持缺失，不能用 `0` 或虚构数据顶替。

你不需要手动编写适配代码。先告诉 Agent：

- 你希望哪些数据出现在总览、星图、社媒或账号页面；
- 这些数据目前保存在哪里，是什么格式；
- 哪些字段必须展示，哪些字段可以缺失；
- 哪些内容属于私人数据，不能进入公开仓库。

然后让 Agent 完成接口梳理、字段映射、数据转换、配置和验证。例如：

```text
我想把自己的知识库接入这个 Workbench。
请先阅读前台页面、服务端索引逻辑和数据模板，列出每个页面需要的数据契约；
再检查我的知识库结构，设计一层映射或转换，不要直接猜字段，也不要用虚构数据补空值。
完成后设置 PERSONAL_DASHBOARD_VAULT_ROOT，并运行测试、构建和隐私扫描。
```

真实知识库应放在公开 Git 仓库之外，再通过本地 `.env` 中的 `PERSONAL_DASHBOARD_VAULT_ROOT` 连接，避免误提交个人资料或账号数据。

## 配套 Agent Skills

社媒洞察和抖音账号数据由独立的 Skills 仓库维护：

- [`research-social-insights`](https://github.com/oyorf/personal-workbench-skills/tree/main/skills/research-social-insights)
- [`douyin-account-data`](https://github.com/oyorf/personal-workbench-skills/tree/main/skills/douyin-account-data)

把 [`personal-workbench-skills`](https://github.com/oyorf/personal-workbench-skills) 的地址发给你的 Agent，让它安装需要的 Skill。安装方式、平台支持、数据契约和完整执行边界以该仓库为准。

### 社媒洞察如何工作

社媒洞察会先用官方或一手来源确认事实，再从科技媒体、中文大众社媒、X 和其他可用海外社区中观察讨论。研究对象包括帖子、一级评论和可见回复；最终会区分事实、用户观点、反方声音与 Agent 的综合判断，并把昵称、头像、账号 ID 等非必要个人信息排除在报告之外。

公开网页使用 Agent 自带的网络搜索和网页读取能力。需要登录或页面交互的来源，会在用户已经授权的浏览器会话中完成真实页面导航、DOM 读取、展开和点击。这条路径不调用平台官方开放 API，也不通过逆向接口、绕过登录或破解反爬来获取数据。结果只写入知识库的 Raw 证据层，不自动生成选题或修改 Wiki。

### 抖音账号数据如何工作

抖音 Skill 只处理用户本人有权访问的创作者中心。Agent 在已授权的页面中模拟正常的页面切换与按钮点击，下载平台提供的官方 Excel，再用页面可见信息补充 Excel 未覆盖的少量字段。下载文件经过解析、一致性检查和质量门禁后，才会生成 Workbench 使用的 `current.json`。

这套流程不调用抖音开放 API，不抓取其他账号，不读取私信，也不提供内容策略。详细的数据范围、临时文件清理、失败回滚和平台支持说明，请查看 [`douyin-account-data`](https://github.com/oyorf/personal-workbench-skills/tree/main/skills/douyin-account-data)。

### 平台规则与使用风险

这些 Skills 是学习、研究和本地自动化示例，不代表任何平台授权，也不能保证自动化交互不会触发登录验证、限流或其他风控。使用者需要确认自己拥有访问权限，并自行遵守相关平台的服务条款和法律要求。

遇到扫码登录、验证码、账号选择、权限门禁、反爬提示或速率限制时，Skill 应停止当前来源，不提供绕过方案。因无授权访问、违反平台规则或不当使用造成的账号限制及其他损失，由使用者自行承担。

## 示例与隐私

`个人知识库/` 中的文章、书籍、风向快照、作品标题、账号指标和时间序列全部是从零编写的 synthetic demo，不来自任何真实个人或账号。

公开前在 Workbench 中执行：

```bash
npm test
npm run privacy:scan
```

隐私扫描覆盖整个仓库，包括与 Workbench 并列的 `个人知识库/`。

## 开发验证

```bash
cd Workbench
npm test
npm run build
npm run privacy:scan
```

## 许可证

MIT。见 [LICENSE](LICENSE)。
