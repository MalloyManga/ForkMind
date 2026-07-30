# ForkMind AI 能力与资料读取 Backlog

本文记录模型选择、文件解析、URL 读取、视觉输入和联网工具的讨论结论。当前只定义方向和验收边界，不代表功能已经实现。

## 1. 目标体验

AI Connection 中的模型字段最终支持两种输入方式：

1. 手动输入模型名称，兼容任何 OpenAI-compatible 服务。
2. 点击下拉框，从当前 Provider 返回的模型列表中选择。

模型列表加载失败时不能阻塞手动输入。用户仍然可以填写 Base URL、API Key 和模型名。

## 2. Provider 与模型列表

### 2.1 读取模型列表

大多数 OpenAI-compatible 服务提供：

```http
GET {baseUrl}/models
Authorization: Bearer {apiKey}
```

典型响应包含模型 ID：

```json
{
  "data": [
    { "id": "qwen2.5:7b", "object": "model" },
    { "id": "llama3.1:8b", "object": "model" }
  ]
}
```

但这不是所有本地服务都严格实现的标准。架构上应把它视为“能力增强的探测接口”，不是配置前置条件。

### 2.2 推荐数据流

```text
用户填写 Base URL / API Key
  -> React 请求 ListModels Bridge
  -> Go 规范 URL 并请求 /models
  -> Go 只返回安全的 model id 列表
  -> React 渲染 options
  -> 用户仍可手动编辑 model
```

React 不应直接访问 Provider。这样 API Key、超时、错误归一化和 Wails 桌面端行为保持一致。

### 2.3 失败策略

- Base URL 为空：不请求。
- `/models` 返回 404 或不支持：显示加载失败，保留手动输入。
- API Key 错误：显示鉴权错误，但不清空已有模型。
- 网络超时：显示可重试状态。
- 模型列表为空：不覆盖当前手动填写的模型名。

## 3. 模型能力不是普通模型列表字段

模型是否支持视觉、Tool Calling 或结构化输出，理论上是模型能力；但 `/models` 返回的 JSON 通常只包含 `id`、`object`、`owned_by` 等基础字段，不保证返回：

```json
{
  "vision": true,
  "toolCalling": true,
  "contextWindow": 128000
}
```

因此不应该简单地让用户手动打开“多模态 Toggle”。这会产生错误承诺：用户打开后，实际模型可能仍然拒绝图片。

### 3.1 推荐的能力推断顺序

```text
Provider 明确返回 capabilities
  -> 使用 Provider 返回值
没有 capabilities
  -> 查本地能力注册表
没有注册表记录
  -> 采用保守默认值
请求真正使用某能力
  -> Provider 返回不支持错误
  -> 给出清晰错误并记录模型能力缓存
```

能力注册表可以由应用维护，而不是暴露成用户开关：

```ts
interface ModelCapability {
    modelId: string
    vision: boolean
    toolCalling: boolean
    structuredOutput: boolean
    source: "provider" | "registry" | "unknown"
}
```

未来可以增加“刷新能力探测”，但 UI 只在当前功能需要时决定是否发送图片或工具定义。用户选择模型，不需要理解内部能力标记。

### 3.2 能力探测的现实边界

能力探测只能提高成功率，不能替代真正请求。原因包括：

- 同一个模型 ID 在不同 Provider 上能力不同。
- Provider 可能修改模型别名。
- 本地运行时可能禁用 Tool Calling。
- 模型支持视觉输入，但上下文长度不足以处理大图片。

所以真正的请求仍必须处理“不支持该能力”的 Provider 错误。

## 4. URL Card MVP

第一版只处理用户已经明确放进 Link Card 的 URL，不做搜索。

### MVP 行为

1. 用户创建 Link Card 并填写 HTTP/HTTPS URL。
2. 用户把 Link Card 连接为当前 Chat 的 reference。
3. Go 在发送请求前抓取这个确定 URL。
4. 提取 HTML 正文，删除 script、style 和明显导航噪声。
5. 限制响应大小、重定向次数和超时时间。
6. 将内容标记为外部不可信资料，注入 system 背景区。

### 明确不做

- 不自动搜索关键词。
- 不执行网页 JavaScript。
- 不读取浏览器 Cookie。
- 不抓取没有被用户引用的 URL。
- 不允许模型随意传入任意 URL。

## 5. 文件读取 MVP

第一版优先做本地文本提取，不依赖 Provider 的专有文件上传协议。

### 首批文件类型

| 类型 | 解析方式 | 结果 |
| --- | --- | --- |
| Markdown | 直接读取 UTF-8 文本 | 清洗后的 Markdown 文本 |
| TXT / 记事本 | 读取文本并检测编码 | 纯文本 |
| PDF | 提取文本层 | 纯文本；扫描 PDF 暂不保证 |
| DOCX / Word | 解包 XML 并提取段落 | 纯文本 |

文件读取流程：

```text
File Card reference
  -> Managed Asset Repository
  -> MIME / 文件头 / 大小校验
  -> AssetExtractor 按策略读取
  -> 清洗和截断
  -> 标记为本地参考资料
  -> 注入 AI 上下文
```

### 第一版安全限制

- 只读取 Managed Asset 目录中的文件。
- 不把绝对路径发送给模型。
- 每个文件限制最大字节数和最大提取文本长度。
- 解析失败返回明确错误，不静默当成空文件。
- 二进制内容不会直接转成乱码文本发送。

### 后续扩展

- XLSX、PPTX、CSV、JSON、HTML。
- 图片 OCR。
- 扫描 PDF OCR。
- Provider 专有文件上传协议。
- 按文档章节切片和向量检索。

## 6. 视觉输入

图片不是“读取文件文字”的同一条链路。视觉模型需要多模态 message content：

```json
{
  "type": "image_url",
  "image_url": {
    "url": "data:image/png;base64,..."
  }
}
```

因此后续需要：

1. 把 Go 的 `OpenAIMessageDTO.Content` 从单一 string 扩展为 string 或 content block 数组。
2. 仅当当前模型能力被判定为 vision 时才附加图片。
3. 限制图片 MIME、像素尺寸、编码大小和总 token 预算。
4. Provider 拒绝图片时返回可理解的错误。

用户不需要看到一个“我保证模型支持视觉”的开关。应用应根据模型能力尽量判断，失败后再提示模型不支持。

## 7. 联网搜索的后续边界

读取确定 URL 和搜索互联网是两个不同功能：

- `fetch_url(url)`：用户已经提供目标 URL。
- `web_search(query)`：模型或用户需要发现未知网页。

`web_search` 需要独立的搜索 Provider 或 API Key，不能仅靠 OpenAI-compatible Chat API 自动获得。它应在未来作为单独的 Tool Calling 能力设计，默认关闭，并且每次请求都要受超时、域名、结果数量和内容大小约束。

## 8. 实施顺序

- [ ] `ListModels` Go Bridge 和 AI Connection 下拉框
- [ ] 模型列表加载失败时的手动输入降级
- [ ] Provider / 本地注册表 / unknown 三层能力来源
- [ ] Link Card 确定 URL 抓取 MVP
- [x] Markdown 和 TXT 文件提取
- [x] PDF 常见文本流提取 扫描 PDF 和复杂字体映射留待后续
- [x] DOCX 文本提取
- [ ] 文件读取权限和大小限制 UI
- [x] 多模态 message content
- [x] 图片引用到 vision 模型 Provider 能力自动发现留待模型能力分支
- [ ] `fetch_url` 安全封装
- [ ] `web_search` 独立工具和权限
