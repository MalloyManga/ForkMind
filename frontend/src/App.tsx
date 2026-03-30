import { type ChangeEvent, useMemo, useState } from "react"
import logo from "./assets/images/logo-universal.png"
import { Greet } from "../wailsjs/go/main/App"
import { buildRootNodesWarningMessage } from "./domain/conversation/rules"
import { useConversationStore } from "./stores/useConversationStore"

function App() {
    const [resultText, setResultText] = useState(
        "Please enter your name below 👇",
    )
    const [name, setName] = useState("")
    const cards = useConversationStore((state) => state.activeThread.cards)

    // useMemo 避免每次输入框变更都重复计算根节点提示。
    const rootNodesWarning = useMemo(
        () => buildRootNodesWarningMessage(cards),
        [cards],
    )

    // 受控输入：React 对应 Vue 的 v-model（输入事件 + 状态更新）。
    const updateName = (e: ChangeEvent<HTMLInputElement>) =>
        setName(e.target.value)
    const updateResultText = (result: string) => setResultText(result)

    function greet() {
        Greet(name).then(updateResultText)
    }

    return (
        /**
         * 目前页面结构仍是模板级 UI，重点在数据流教学：
         * Store 里的 cards -> 领域规则函数 -> 视图告警提示。
         */
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

            {/* 根节点过多时给出架构提示，避免一个对话无限膨胀。 */}
            {rootNodesWarning ? (
                <div className="mx-auto mt-6 w-full max-w-3xl rounded-lg border border-amber-300/40 bg-amber-300/10 px-4 py-3 text-sm leading-6 text-amber-200">
                    {rootNodesWarning}
                </div>
            ) : null}

            {/* 受控输入框：输入值经事件写入 state，再由 state 驱动 UI。 */}
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
        </div>
    )
}

export default App
