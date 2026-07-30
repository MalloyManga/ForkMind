# ForkMind 系统剪贴板方案与演进路线

## 1. 决策摘要

ForkMind 画布复制粘贴只使用系统剪贴板作为唯一事实源。

- Copy 将选中卡片序列化为带 `format` 和 `version` 的 ForkMind JSON。
- Paste Here 每次重新读取系统剪贴板，完成解析、校验和规范化后写入 Zustand。
- Paste to Replace 使用相同的系统 JSON 输入，只改变最终 Store action。
- 页面内存不再保存第二份 clipboard payload。
- 输入框、文本域和 `contenteditable` 保持浏览器原生复制粘贴，不进入画布命令。

这个边界与项目的单一数据源原则一致：系统剪贴板负责跨应用传输，Zustand 负责当前工作区节点树，tldraw 只负责画布投影。

## 2. MVP 范围

系统文本剪贴板识别 ForkMind JSON、单个 HTTP(S) URL 和普通文本或 Markdown。

| 系统剪贴板内容 | 画布 Paste 行为 | 编辑器 Paste 行为 |
| --- | --- | --- |
| 合法 ForkMind JSON | 校验后创建或替换卡片 | 原生粘贴文本 |
| 非 ForkMind JSON | 创建 Note Card | 原生粘贴文本 |
| 空文本 | 拒绝 | 原生粘贴 |
| 超过 8 MiB 的文本 | 在 `JSON.parse` 前拒绝 | 原生粘贴 |
| URL | 创建 Link Card | 原生粘贴 URL |
| 普通文本或 Markdown | 创建 Note Card | 原生粘贴文本 |
| 图片或文件 | 暂不读取二进制 MIME | 由目标输入控件决定 |

系统文本会先转换为统一的 `CanvasClipboardPayload`，再复用现有 Store 粘贴事务，不会让外部数据绕过领域校验直接进入 Zustand。

## 3. JSON 契约

系统剪贴板使用现有版本化包装：

```json
{
  "format": "forkmind-canvas-clipboard",
  "version": 1,
  "payload": {
    "nodes": [],
    "sourceTopLeft": {
      "x": 0,
      "y": 0
    }
  }
}
```

`payload.nodes` 保存卡片快照和被复制集合内部的关系。粘贴时不会复用旧节点 id 或时间戳，Store 会生成新 id 并重新映射 `parentId`、`referenceNodeIds` 和文本锚点。

图片与文件卡片当前只复制 managed asset 引用，不把二进制写入系统剪贴板。因此同一工作区内复制可继续解析资产；跨工作区传输完整资产仍应使用工作区导出格式。

## 4. Copy 数据流

### 4.1 目标解析

1. 优先读取 tldraw 当前 selection。
2. 没有 selection 时使用右键命中的卡片。
3. 再退化到当前 active card。
4. 没有业务卡片时不改写系统剪贴板。

### 4.2 序列化

1. 从 Zustand 卡片数组取得目标卡片。
2. 克隆快照并移除原始 id、创建时间和更新时间的直接复用语义。
3. 计算被复制集合左上角，供粘贴时保持相对布局。
4. 写入 `format + version + payload` JSON。

### 4.3 系统写入

优先使用浏览器 Clipboard API。Wails WebView 权限或运行环境不支持时，退化到 Wails Runtime `ClipboardSetText`。

## 5. Paste 数据流

### 5.1 读取

每次 Paste 都重新读取系统剪贴板，不使用 React state 缓存。这样从浏览器、编辑器或另一个 ForkMind 窗口复制的数据会立即成为下一次粘贴输入。

### 5.2 解析与校验

顺序固定为：

```text
read text
  -> size guard
  -> JSON.parse
  -> format/version check
  -> payload shape check
  -> workspace validator
  -> relation normalization
  -> CanvasClipboardPayload
```

任何阶段失败都不会写入 Zustand。

### 5.3 Store 事务

- Paste Here 使用右键 page point；快捷键粘贴使用当前画布视口中心。
- Paste to Replace 使用当前 selection 或 active card 作为替换目标。
- Store 在一次 action 中生成全部新节点、重映射内部关系并写入历史栈。
- tldraw 继续由 Canvas Bridge 从 Store 投影，不直接接收剪贴板节点。

## 6. 原生文本输入边界

App 的全局快捷键监听必须先判断事件目标：

- `input`
- `textarea`
- `contenteditable`

命中这些目标时不执行 Canvas Copy/Paste，也不调用 `preventDefault`。因此右侧编辑器中的普通文字、URL 和 Markdown 粘贴保持原生行为。

## 7. 错误与安全边界

- 外部 JSON 一律视为不可信输入。
- 禁止 `any`，解析入口保持 `unknown`。
- 在解析前限制系统剪贴板文本长度。
- 校验卡片类型、状态、位置、尺寸、关系和重复 id。
- 粘贴时生成新 id，避免覆盖已有节点。
- 关系规范化必须防止悬空关系和非法锚点。
- Clipboard API 权限失败时返回明确错误，不吞掉异常。
- MVP 不执行 JSON 中声明的命令、路径或脚本。

## 8. 后续升级路线

### Phase 1：纯 URL

只在去除首尾空白后，完整文本能通过 `new URL()` 且协议属于允许列表时识别为 URL。

建议行为：

- `http` 和 `https` 创建 Link Card。
- 不自动请求网页，不抓取标题，不执行重定向。
- URL 写入卡片 `url`，标题使用 hostname 或等待用户编辑。
- 混有其它文字的内容不按 URL 处理。

需要确认：是否允许 `mailto`、`file` 和自定义协议。默认建议只允许 `http/https`。

### Phase 2：普通文本

非 JSON、非 URL 的非空文本可以创建卡片。

建议默认创建 Note Card，因为“粘贴资料”不等于“向模型发送问题”。用户可以随后转换类型或从 Note 建立 Chat 分支。

需要确认：是否根据当前创建工具决定 Chat/Note，还是始终使用 Note。默认建议始终 Note，行为更稳定。

### Phase 3：图片 MIME

浏览器 Clipboard API 能提供图片 Blob 时，前端读取 MIME 和字节并交给新的 Wails Bridge。

建议新增 Go 能力：

```text
ImportManagedAssetBytes(kind, fileName, mimeType, bytes)
```

Go 继续复用现有 64 MiB、MIME 检测、SHA-256 去重、安全文件名和原子写入规则。成功后 React 创建 Image Card，Zustand 仍是唯一节点数据源。

需要验证 WebView2 对 PNG、JPEG、WebP 和截图工具 ClipboardItem 的实际支持。

### Phase 4：系统文件列表

Windows 文件复制通常使用原生文件列表格式，浏览器 Clipboard API 无法稳定取得完整路径。该阶段应由 Go 读取系统原生剪贴板，再调用现有 managed asset repository。

需要单独评估：

- Windows、macOS、Linux 的平台差异。
- 多文件一次粘贴的卡片排列方式。
- 图片文件创建 Image Card，其它文件创建 File Card。
- 目录、快捷方式、超限文件和权限错误的反馈方式。

### Phase 5：富文本与 HTML

最后再考虑 `text/html`。默认建议先转成受限 Markdown 或纯文本，并经过 HTML 清洗，禁止直接把外部 HTML 注入卡片 DOM。

## 9. 建议测试矩阵

### MVP

- 单卡、多选卡片和包含内部关系的复制粘贴。
- 从一个 ForkMind 窗口复制到另一个窗口。
- 外部修改 JSON 后粘贴。
- 错误 format、错误 version、空 nodes、重复 id 和非法关系。
- 普通文本、URL、空剪贴板和超大文本。
- Clipboard API 失败后 Wails Runtime fallback。
- 输入框和文本域中的 Ctrl/Cmd+C、Ctrl/Cmd+V 不被 Canvas 抢占。
- Paste Here 与 Paste to Replace 各自只产生一次 Store 历史事务。

### 后续 MIME

- 浏览器复制图片、系统截图、文件管理器图片和多文件复制。
- 资产去重、超限、伪造 MIME、路径逃逸和损坏内容。

## 10. 维护原则

1. 系统剪贴板只负责传输，不负责业务状态。
2. 所有外部内容先分类和校验，再进入 Store。
3. Zustand 始终是卡片与关系的唯一事实源。
4. tldraw 只消费 Store 投影，不直接粘贴领域节点。
5. 新 MIME 类型按独立 Phase 增加，不在一个 Paste 分支中堆叠隐式猜测。
6. 任何自动创建规则都必须可预测、可撤销，并形成单次历史事务。
