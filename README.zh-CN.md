<div align="center">

# ForkMind

**一个用于分支对话与可视化思考的本地优先 AI 无限画布。**

[English](./README.md) | [简体中文](./README.zh-CN.md)

[![Website](https://img.shields.io/badge/Website-ForkMind-0ea5e9)](https://malloymanga.github.io/ForkMind/)
[![Release](https://img.shields.io/badge/Release-v0.1.0-2563eb)](https://github.com/MalloyManga/ForkMind/releases)
[![License](https://img.shields.io/badge/License-MIT-16a34a)](./LICENSE)
[![Wails](https://img.shields.io/badge/Wails-v2-cb3837)](https://wails.io/)

</div>

![ForkMind Banner](./banner.png)

ForkMind 将线性的 AI 对话转换为由卡片连接而成的可视化工作区。你可以从任意想法创建分支 添加参考资料 并探索衍生问题 同时保持主对话上下文清晰。

- 项目网站: [malloymanga.github.io/ForkMind](https://malloymanga.github.io/ForkMind/)
- 版本下载: [github.com/MalloyManga/ForkMind/releases](https://github.com/MalloyManga/ForkMind/releases)

## 核心特性

- **无限画布** 基于 tldraw 实现卡片排列 缩放 连线 选择与组织。
- **分支感知的 AI 上下文** 只沿当前卡片的父链构造上下文 不会混入兄弟分支。
- **参考关系** 可以补充其他卡片作为资料 同时不改变主对话路径。
- **选区追问** 保存被选中的文本及其来源卡片。
- **OpenAI-compatible Provider** 支持模型发现 流式回复 取消请求和可选的模型原生联网搜索。
- **丰富的参考输入** 支持常见文档文本 URL 内容和多模态图片参考。
- **本地优先存储** 支持工作区 JSON 导入 导出 复制与粘贴。
- **多种卡片类型** 支持对话 笔记 图片 链接和文件。

## 上下文如何工作

ForkMind 将对话图保存在 Zustand 中 并通过两种关系表达上下文:

- `parentId` 定义主要对话链。
- `referenceNodeIds` 补充参考资料 但不会改变主链。

每次发起 AI 请求时 ForkMind 会向上遍历当前卡片的父链 解析参考卡片和可选文本选区 注入内部系统身份 然后通过 Go 网络层发送最终请求。流式响应会写回同一个由 Zustand 管理的卡片树。

## 技术栈

| 层级 | 技术 |
| --- | --- |
| 桌面运行时 | Wails v2 和 Go |
| 前端 | React 18 TypeScript 和 Vite |
| 无限画布 | tldraw SDK |
| 状态管理 | Zustand |
| UI | Tailwind CSS 和 shadcn/ui 规范 |
| AI 通信 | OpenAI-compatible API 和 SSE 流式传输 |
| 持久化 | 本地 JSON 文档和托管资产 |

React 前端的职责类似 Electron 渲染进程。Go 层负责原生 Bridge 文件系统访问 持久化 文档解析和 AI 网络通信。

## 下载

前往 [GitHub Releases](https://github.com/MalloyManga/ForkMind/releases) 下载最新的 Windows 安装包或便携版程序。

ForkMind 当前主要支持 Windows AMD64。其他平台可能在后续版本中提供。

## 数据与隐私

ForkMind 不要求注册账号 也不依赖 ForkMind 云服务。

| 运行方式 | 数据目录 |
| --- | --- |
| 安装版或便携版 | `<软件目录>/data/` |
| `wails dev` | `<项目目录>/.forkmind-dev-data/` |

- 工作区和对话数据保存在用户本机。
- API Key 只保存在运行时内存 不会写入工作区文件。
- AI 请求只发送到用户主动配置的 Provider。
- 托管文件保存在本地 并通过 SHA-256 去重。
- 显式导出工作区时可以把引用资产写入可迁移的 JSON 文档。

## 本地开发

### 环境要求

- Node.js 20 或更高版本
- npm 10 或更高版本
- Go 1.23 或更高版本
- Wails CLI v2

如未安装 Wails CLI:

```bash
go install github.com/wailsapp/wails/v2/cmd/wails@latest
```

安装项目依赖:

```bash
go mod tidy
cd frontend
npm install
cd ..
```

启动桌面开发环境:

```bash
wails dev
```

运行完整验证:

```bash
cd frontend
npm run build
cd ..

go test ./...
go test -tags dev ./...
go vet ./...
go vet -tags dev ./...
```

## Windows 构建

安装 [NSIS](https://nsis.sourceforge.io/) 并在构建终端提供有效的 tldraw 生产许可证:

```bash
export VITE_TLDRAW_LICENSE_KEY='tldraw-your-license-key'
wails build -clean -platform windows/amd64 -nsis
```

构建产物位于 `build/bin/`:

- `ForkMind.exe`: 便携版程序。
- `ForkMind-amd64-installer.exe`: Windows 安装包。

安装器提供目录选择页。将 ForkMind 安装到其他磁盘后 软件本体与 `data/` 工作区都会保存在该磁盘。

## 参与贡献

欢迎提交 Issue 功能建议 文档改进和 Pull Request。提交代码前请确保:

1. 对话状态保存在 Zustand 原生副作用位于 Go/Wails 层。
2. 新增的 Go 后端业务逻辑包含对应单元测试。
3. 已运行上方列出的验证命令。
4. 提交信息遵循 [Conventional Commits](https://www.conventionalcommits.org/) 规范。

## 开源许可证

ForkMind 原创源码使用 [MIT License](./LICENSE)。

tldraw SDK 是使用 [tldraw license](https://tldraw.dev/community/license) 分发的第三方依赖。生产使用需要合适的 Trial Commercial 或 Hobby License Key。下游用户和分发者需要自行遵守 tldraw 的许可证条款。
