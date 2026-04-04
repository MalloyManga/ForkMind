import { type ChangeEvent, useMemo, useState } from "react"
import logo from "./assets/images/logo-universal.png"
import { Greet } from "../wailsjs/go/main/App"
import { buildRootNodesWarningMessage } from "./domain/conversation/rules"
import {
    selectActiveNode,
    selectActiveThreadCards,
    selectActiveNodeId,
    useConversationStore,
} from "./stores/useConversationStore"

function App() {
    /**
     * 这块保留 Wails 模板的最小调用链，用于验证前后端桥接可用。
     * 后续接入真实 LLM 调用后，会由 conversation action 替代这条调用。
     */
    const [resultText, setResultText] = useState("Please enter your name below 👇")
    const [name, setName] = useState("")

    /**
     * 读状态：
     * - cards：画布上全部节点
     * - activeNodeId：当前选中节点 id
     * - activeNode：右侧编辑栏实际编辑目标
     */
    const cards = useConversationStore(selectActiveThreadCards)
    const activeNodeId = useConversationStore(selectActiveNodeId)
    const activeNode = useConversationStore(selectActiveNode)

    /**
     * 写状态（语义化 action）：
     * 组件层只发业务意图，不自己拼接新数组。
     */
    const setActiveNodeId = useConversationStore((state) => state.setActiveNodeId)
    const addChatNode = useConversationStore((state) => state.addChatNode)
    const addNoteNode = useConversationStore((state) => state.addNoteNode)
    const updateChatPrompt = useConversationStore((state) => state.updateChatPrompt)
    const updateChatResponse = useConversationStore((state) => state.updateChatResponse)
    const updateNoteContent = useConversationStore((state) => state.updateNoteContent)

    /**
     * 根节点告警：使用领域规则函数，保持 UI 与业务规则解耦。
     */
    const rootNodesWarning = useMemo(() => buildRootNodesWarningMessage(cards), [cards])

    const updateName = (e: ChangeEvent<HTMLInputElement>) =>
        setName(e.target.value)
    const updateResultText = (result: string) => setResultText(result)

    function greet() {
        Greet(name).then(updateResultText)
    }

    return (
        <div className="min-h-screen bg-slate-900 px-6 py-10 text-white">
            <div className="mx-auto flex w-full max-w-4xl flex-col items-center">
                <img
                    src={logo}
                    alt="ForkMind logo"
                    className="w-full max-w-md object-contain pt-6"
                />
                <div className="mt-6 text-center text-base leading-6">
                    {resultText}
                </div>
            </div>

            {rootNodesWarning ? (
                <div className="mx-auto mt-6 w-full max-w-3xl rounded-lg border border-amber-300/40 bg-amber-300/10 px-4 py-3 text-sm leading-6 text-amber-200">
                    {rootNodesWarning}
                </div>
            ) : null}

            <div className="mx-auto mt-6 flex w-full max-w-xl items-center justify-center gap-4">
                <input
                    id="name"
                    className="h-10 flex-1 rounded-md border border-transparent bg-slate-100 px-3 text-slate-900 outline-none transition focus:border-slate-300 focus:bg-white"
                    onChange={updateName}
                    autoComplete="off"
                    name="input"
                    type="text"
                />
                <button
                    className="h-10 rounded-md bg-slate-100 px-4 text-sm font-medium text-slate-900 transition hover:bg-white"
                    onClick={greet}
                >
                    Greet
                </button>
            </div>

            {/**
              * 这是阶段 2 的“active 节点编辑验证区”：
              * - 左列：节点列表（模拟画布选中）
              * - 右列：按节点类型切换编辑表单（chat 双框 / note 单框）
              */}
            <div className="mx-auto mt-8 grid w-full max-w-6xl gap-6 md:grid-cols-[280px_1fr]">
                <aside className="rounded-xl border border-slate-700/60 bg-slate-800/40 p-4">
                    <div className="mb-3 flex items-center justify-between">
                        <h2 className="text-sm font-semibold text-slate-200">Nodes</h2>
                        <div className="flex gap-2">
                            <button
                                className="rounded-md bg-slate-100 px-2 py-1 text-xs font-medium text-slate-900 hover:bg-white"
                                onClick={() => {
                                    addChatNode()
                                }}
                            >
                                +Chat
                            </button>
                            <button
                                className="rounded-md bg-slate-100 px-2 py-1 text-xs font-medium text-slate-900 hover:bg-white"
                                onClick={() => {
                                    addNoteNode()
                                }}
                            >
                                +Note
                            </button>
                        </div>
                    </div>
                    <div className="space-y-2">
                        {cards.map((card) => (
                            <button
                                key={card.id}
                                className={`w-full rounded-md border px-3 py-2 text-left text-xs transition ${activeNodeId === card.id
                                    ? "border-sky-400 bg-sky-500/20 text-sky-100"
                                    : "border-slate-700 bg-slate-900/40 text-slate-300 hover:border-slate-500"
                                    }`}
                                onClick={() => {
                                    setActiveNodeId(card.id)
                                }}
                            >
                                <div className="font-semibold uppercase tracking-wide">
                                    {card.type}
                                </div>
                                <div className="mt-1 truncate text-[11px] opacity-80">
                                    {card.type === "chat"
                                        ? card.userPrompt || "(empty prompt)"
                                        : card.noteContent || "(empty note)"}
                                </div>
                            </button>
                        ))}
                    </div>
                </aside>

                <section className="rounded-xl border border-slate-700/60 bg-slate-800/40 p-4">
                    <h2 className="mb-3 text-sm font-semibold text-slate-200">
                        Active Editor
                    </h2>
                    {!activeNode ? (
                        <div className="rounded-md border border-dashed border-slate-600 px-4 py-8 text-sm text-slate-400">
                            当前没有选中节点。
                        </div>
                    ) : (
                        <div className="space-y-4">
                            <div className="text-xs text-slate-400">
                                Type: <span className="font-semibold">{activeNode.type}</span>
                            </div>

                            {/**
                              * chat：双编辑区（用户输入 + AI 输出）
                              * note：单编辑区（noteContent）
                              *
                              * 这里先用 CSS transition 做过渡，避免新增依赖。
                              * 如果你确认安装 motion，下一步可替换成 AnimatePresence。
                              */}
                            <div
                                className={`grid gap-3 transition-all duration-300 ${activeNode.type === "chat" ? "grid-rows-[1fr_1fr]" : "grid-rows-[1fr_0fr]"
                                    }`}
                            >
                                <div className="rounded-md border border-slate-600 bg-slate-900/40 p-3">
                                    <div className="mb-2 text-xs font-semibold text-slate-300">
                                        {activeNode.type === "chat" ? "User Prompt (Markdown)" : "Note Content (Markdown)"}
                                    </div>
                                    <textarea
                                        className="h-36 w-full resize-y rounded-md border border-slate-700 bg-slate-950/40 p-2 text-sm text-slate-100 outline-none focus:border-sky-500"
                                        value={
                                            activeNode.type === "chat"
                                                ? activeNode.userPrompt
                                                : activeNode.noteContent
                                        }
                                        onChange={(event) => {
                                            if (activeNode.type === "chat") {
                                                updateChatPrompt(activeNode.id, event.target.value)
                                                return
                                            }

                                            updateNoteContent(activeNode.id, event.target.value)
                                        }}
                                    />
                                </div>

                                <div
                                    className={`overflow-hidden rounded-md border border-slate-600 bg-slate-900/40 p-3 transition-all duration-300 ${activeNode.type === "chat"
                                        ? "max-h-125 opacity-100"
                                        : "max-h-0 border-transparent p-0 opacity-0"
                                        }`}
                                >
                                    <div className="mb-2 text-xs font-semibold text-slate-300">
                                        AI Response (Markdown)
                                    </div>
                                    <textarea
                                        className="h-36 w-full resize-y rounded-md border border-slate-700 bg-slate-950/40 p-2 text-sm text-slate-100 outline-none focus:border-sky-500"
                                        value={activeNode.type === "chat" ? activeNode.aiResponse : ""}
                                        onChange={(event) => {
                                            if (activeNode.type !== "chat") {
                                                return
                                            }
                                            updateChatResponse(activeNode.id, event.target.value)
                                        }}
                                    />
                                </div>
                            </div>
                        </div>
                    )}
                </section>
            </div>
        </div>
    )
}

export default App
