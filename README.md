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
