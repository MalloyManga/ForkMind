# 🌿 ForkMind (分叉思维)

> **Break free from linear chats. Fork your thoughts.**
> 摆脱线性对话的束缚，让你的 AI 灵感在无限画布上自由分叉。

![ForkMind Architecture](https://img.shields.io/badge/Architecture-Local--First-success)
![Tech Stack](https://img.shields.io/badge/Tech-Wails%20%7C%20React%20%7C%20Go-blue)
![License](https://img.shields.io/badge/License-MIT-green)

## 💡 为什么需要 ForkMind？

在使用传统的大模型（如 ChatGPT, Claude）进行深度学习、代码 debug 或复杂逻辑梳理时，我们经常面临“上下文污染（Context Pollution）”与“无尽滚动（Endless Scrolling）”的地狱：

- 当你在一个长对话中突然想追问一个衍生知识点（如概念 α 和 β），AI 的上下文会被瞬间带偏。
- 当追问结束后想回到主线，你不得不疯狂向上滚动寻找历史记录。

**ForkMind 彻底重构了人机交互形态。** 我们将传统的“线性对话”降维打击为“网状节点（Node-based Graph）”。在这里，你的每一次追问都是对思维的一次 `Fork`（分叉）。

## ✨ 核心特性 (Core Features)

- 🎨 **无限画布空间 (Infinite Canvas)**：左侧为无边界的可拖拽画布，右侧为极简对话框。告别上下翻滚，全局思维脉络一目了然。
- 🔀 **独立上下文分支 (Isolated Context Chains)**：
  - 从对话卡片 A 中引出追问卡片 B。
  - **核心算法**：采用 **树的向上遍历（Upward Tree Traversal）** 算法。卡片 B 仅继承 A 及 A 的祖先节点作为上下文，其他兄弟分支互不干扰。
- 🔌 **BYOK & 完美支持本地大模型 (Local LLMs)**：
  - 专为重度效率用户与开发者设计。填入你的 API Key（如 OpenAI, DeepSeek），享受极低成本的顶级算力。
  - **零跨域限制**：得益于 Go 语言底层网络请求，完美规避浏览器 CORS 限制与混合内容拦截（Mixed Content）。原生支持连接本地 `Ollama` 等离线大模型。
- 💾 **Local-First 数据流 (JSON 驱动)**：
  - 无需注册，无需云端服务器。画布与对话数据采用最原始的 `.json` 格式存储在本地。
  - **极客友好**：用户可随意导出、分享、甚至使用 VSCode 手动二次编辑对话节点树。

## 🛠 技术架构 (Tech Stack)

ForkMind 采用极其轻量且高性能的跨平台桌面端架构：

- **核心框架**: [Wails](https://wails.io/) (基于 Go 的轻量级桌面端应用框架，替代臃肿的 Electron)
- **前端生态**: React 18 + Vite
- **状态管理**: Zustand (在内存中维护对话节点树结构)
- **AI 交互层**:
  - 动态注入 System Prompt 控制输出格式。
  - 动态拼接历史节点上下文。

## ⚙️ 底层原理：AI 是如何读取上下文的？

ForkMind 在发起对话请求时，会在内存中执行以下操作：

1. **定位当前节点**，顺着 `parentId` 指针执行向上遍历（Upward Traversal），直至根节点。
2. 将这条纯净的历史线翻转，拼接成完整的消息数组。
3. 在数组第 0 项注入**系统提示词 (System Prompt)**，规范 AI 在无限画布环境下的回答行为。
4. 交由 Go 底层向大模型 API 发起请求，确保通信安全与极速响应。

## 🧭 开发阶段（长期版本）

- [x] 阶段 0：工程基线稳定（依赖可安装、项目可构建、工具链版本对齐）。
- [x] 阶段 1：数据模型定稿（`ConversationCard / ConversationThread`、`parentId` 主链、`referenceNodeIds` 参考链）。
- [ ] 阶段 2：Zustand 业务操作层（新增卡片、Fork 子卡片、更新提问与回答、删除与移动）。
- [ ] 阶段 3：单页三栏 UI 壳（左侧会话栏/中间无限画布/右侧输入栏，左右栏可收起）。
- [ ] 阶段 4：画布与节点面板联动（tldraw 节点和 Store 数据双向同步，保持低心智拖拽交互）。
- [ ] 阶段 5：Markdown 卡片渲染（AI 输出内容在卡片中按 Markdown 展示）。
- [ ] 阶段 6：多会话管理（新建会话、切换会话、卡片跨会话复制）。
- [ ] 阶段 7：Wails Bridge 契约层（React DTO 与 Go DTO 对齐、统一错误协议）。
- [ ] 阶段 8：Go 上下文组装算法（`parentId` 主链遍历 + `referenceNodeIds` 参考注入）。
- [ ] 阶段 9：模型调用层（BYOK 云模型与本地 Ollama 的统一 Provider 入口）。
- [ ] 阶段 10：本地 JSON 持久化（会话保存、加载、损坏恢复）。
- [ ] 阶段 11：质量收敛与发布准备（Go 单测、日志与错误码、构建与回归检查）。

## 🔭 未来展望 (Roadmap)

- [x] 单个对话支持多个根节点；当根节点过多时，提示用户“建议新开对话”。
- [ ] 支持把当前对话中的部分卡片复制到其他对话，实现无缝迁移。
- [ ] 引入“关联边/引用边（Reference Edge）”，满足自由联想与跨分支关系表达。
- [ ] 固化“主链 + 参考资料”上下文策略：`parentId` 负责主链遍历，`referenceNodeIds` 以“补充参考资料”形式注入提示词。
- [ ] 支持在卡片文本中选中词/句直接追问：从选中内容拉线创建新卡片，并记录引用锚点。
