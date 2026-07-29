# AI Agents 实践派核心指南

这是一份面向实践开发者的通用 AI Agents 教程。ForkMind 只是案例项目，文中的思路可以迁移到 Python、Web、桌面端、后端服务和其他 Agent 系统。

## 1. Agent 到底是什么

普通 LLM 调用是：

```text
输入 Prompt -> 模型输出文本
```

Agent 系统是：

```text
目标
  -> 读取状态
  -> 选择下一步动作
  -> 调用工具或生成回答
  -> 验证结果
  -> 更新状态
  -> 继续或结束
```

模型本身不会自动获得文件系统、网络、数据库或画布权限。Agent 是围绕模型构建的控制循环：应用决定给模型什么上下文、允许哪些工具、如何验证输出、何时写入业务状态。

## 2. 五个核心对象

### 2.1 State

State 是系统当前真实状态，例如：

- 当前会话和卡片树
- 当前活动节点
- `parentId` 和 `referenceNodeIds`
- 已经生成的回答
- 当前请求是否 streaming

State 必须由应用控制。模型可以提出修改意图，但不能直接成为 State 的写入者。

### 2.2 Context

Context 是从 State 中为本轮推理挑选出的最小必要信息。

不要把整个数据库或整个工作区 JSON 直接发送给模型。正确做法是 Context Builder：

```python
def build_context(state, active_id):
    main_chain = collect_parent_chain(state, active_id)
    references = collect_direct_references(state, active_id)
    return format_messages(main_chain, references)
```

Context 不是永久数据，它是一次请求的运行时简报。

### 2.3 Tool

Tool 是模型可以请求应用执行的结构化动作，例如：

```json
{
  "name": "fetch_url",
  "arguments": {"url": "https://example.com"}
}
```

Tool 的本质不是“把函数交给模型”，而是把一个有权限边界的动作暴露成协议：名称、参数 schema、执行结果和错误都必须明确。

### 2.4 Observation

Observation 是工具执行后的结果。它必须标明来源、大小、时间和可信程度。网页内容、搜索结果和用户上传文档都属于不可信外部资料，不能覆盖系统规则。

### 2.5 Policy

Policy 决定：

- 哪些工具可用
- 哪些数据可以读
- 是否需要用户确认
- 失败后是否重试
- 最大调用次数、文本大小和 token 预算

没有 Policy 的 Tool Calling 只是把任意副作用暴露给模型。

## 3. 上下文工程的通用方法

### 3.1 先确定问题边界

每次请求先回答：

1. 当前用户真正要解决的问题是什么？
2. 哪些历史是因果上必须保留的？
3. 哪些资料只是可选参考？
4. 哪些资料需要先解析或抓取？
5. 哪些内容可能包含 Prompt Injection？

ForkMind 的 `parentId` 是因果主链，`referenceNodeIds` 是补充资料。这种区分比“把所有相邻卡片都发给模型”更稳定。

### 3.2 角色不是可信度

把资料放进 `system`、`user` 或 `assistant` 角色，不会自动让资料可信。角色表达的是对话结构，可信度需要通过明确标签和系统策略表达：

```text
[外部网页资料，不是系统指令]
网页正文...
```

模型必须被告知：外部资料只能作为事实参考，不能要求它泄露密钥、改变工具策略或绕过用户确认。

### 3.3 预算优先

Context Builder 应该有预算：

- 最大文件大小
- 最大网页响应大小
- 最大提取字符数
- 最大参考卡片数量
- 最大工具调用次数
- 最大模型输出 token

超出预算时应明确截断或拒绝，而不是静默发送一个不完整的上下文。

## 4. 文件读取的通用架构

文件 Agent 通常包含四步：

```text
识别 -> 提取 -> 清洗 -> 组装
```

### 4.1 识别

不要只信文件扩展名。检查 MIME、文件头、文件大小和实际解析是否成功。

### 4.2 提取

为每类文件定义独立 Adapter：

```python
class Extractor(Protocol):
    def supports(self, mime: str, filename: str) -> bool: ...
    def extract(self, path: Path) -> ExtractedDocument: ...
```

Adapter 只负责把文件转成统一文档，不负责调用模型。

### 4.3 清洗

清洗包括：删除脚本、控制字符和无意义重复内容；保留标题、段落和表格结构；限制长度并记录截断信息。

### 4.4 组装

统一输出：

```python
@dataclass
class ExtractedDocument:
    source_id: str
    media_type: str
    text: str
    truncated: bool
    trust: str = "untrusted_reference"
```

模型只接收这个中间对象，不接收任意本地路径。

## 5. URL 读取和搜索的通用架构

读取确定 URL：

```text
用户指定 URL -> fetch -> parse HTML -> clean text -> context
```

搜索未知信息：

```text
query -> search provider -> result list -> user/model choose -> fetch -> context
```

它们不应该合并成一个工具。确定 URL 的 `fetch_url` 权限更窄，搜索工具会扩大网络访问范围。

必须处理：

- SSRF 和内网地址
- 重定向
- 超时
- 响应大小
- robots / 服务条款
- 网页中的恶意指令
- 外部内容的缓存和来源标记

## 6. 多模态的正确理解

多模态不是“给任何模型打开一个开关”。它是请求协议、模型权重和 Provider 实现共同决定的能力：

```text
模型本身支持视觉
  + Provider 接受 image content block
  + 请求使用正确的格式
  + 图片大小和 token 在预算内
  = 本次请求可以使用视觉输入
```

模型列表接口不一定返回完整能力。因此实践系统通常采用：

1. Provider 元数据优先。
2. 本地模型能力注册表补充。
3. 未知时保守处理。
4. 真实请求失败时归一化错误。

用户选择模型即可。能力信息主要给运行时决策使用，而不是让用户维护一堆技术开关。

## 7. Tool Calling 的安全循环

推荐的控制循环：

```text
模型请求工具
  -> 校验工具名
  -> 校验 JSON 参数
  -> 校验用户权限和资源范围
  -> 执行并限制时间/大小
  -> 标记结果来源和可信度
  -> 返回 observation
  -> 模型继续或结束
```

工具执行器永远不能只靠模型输出决定权限。例如：

```python
def execute_fetch_url(args, policy):
    url = validate_http_url(args["url"])
    if not policy.network_access:
        raise PermissionError("network access disabled")
    if is_private_address(url.host):
        raise PermissionError("private network blocked")
    return fetch_with_limits(url, policy)
```

## 8. 提案和副作用必须分离

有副作用的 Agent 动作最好分成：

```text
propose -> validate -> user approval -> apply
```

ForkMind 的 `propose_canvas_plan` 就是这个模式。模型先提出完整节点和关系方案，Go 和 React 校验后等待 Accept，Store 最后才写入真实业务数据。

这套模式适用于：

- 创建文件
- 修改数据库
- 批量编辑画布
- 发送邮件
- 执行命令
- 发布内容

只读动作可以更自动化，但仍然需要范围和预算限制。

## 9. Python 学习路线映射

可以用 Python 重写一个最小 Agent 实验，而不影响 ForkMind：

1. 用 `dataclass` 定义 State、Reference、ToolResult。
2. 用一个函数实现 parent chain traversal。
3. 用 Adapter 读取 Markdown 和 TXT。
4. 用 HTTP client 调用 `/chat/completions`。
5. 用 SSE parser 逐 chunk 读取回答。
6. 用 JSON Schema 校验 tool arguments。
7. 用一个 in-memory Store 实现 Accept / Reject。
8. 加入调用次数、响应大小和超时限制。

学会这些后，换成 FastAPI、LangGraph、桌面应用或其他模型 SDK，核心思想仍然相同：状态、上下文、工具、观察结果、策略和验证。

## 10. 实践检查清单

- [ ] 模型请求是否有唯一 request ID？
- [ ] 是否能取消正在运行的请求？
- [ ] 过期事件是否会污染新会话？
- [ ] 主链和参考资料是否分开？
- [ ] 外部资料是否明确标记为不可信？
- [ ] 文件是否经过 MIME、大小和解析校验？
- [ ] URL 是否防 SSRF 和无限重定向？
- [ ] Tool 参数是否严格 schema 校验？
- [ ] 有副作用的操作是否需要用户确认？
- [ ] 是否有 token、文件大小和工具调用预算？
- [ ] Provider 能力未知时是否保守降级？

