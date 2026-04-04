import { getRootCards } from "../../domain/conversation/rules"
import type { ConversationCard } from "../../domain/conversation/types"
import type { ConversationStoreState } from "./contracts"

/**
 * Selector：当前线程全部节点。
 * 场景：画布层需要渲染所有节点。
 */
export const selectActiveThreadCards = (
    state: ConversationStoreState,
): ConversationCard[] => state.activeThread.cards

/**
 * Selector：当前选中节点 id。
 * 场景：右侧编辑栏根据 activeNodeId 显示对应编辑表单。
 */
export const selectActiveNodeId = (state: ConversationStoreState): string | null => state.activeNodeId

/**
 * Selector：当前选中节点实体。
 * 场景：右侧面板读取当前节点字段进行编辑。
 */
export const selectActiveNode = (
    state: ConversationStoreState,
): ConversationCard | undefined => {
    if (!state.activeNodeId) {
        return undefined
    }

    return state.activeThread.cards.find((node) => node.id === state.activeNodeId)
}

/**
 * Selector：根节点集合。
 * 场景：根节点统计、会话概览、根节点告警提示。
 */
export const selectRootCards = (state: ConversationStoreState): ConversationCard[] => getRootCards(state.activeThread.cards)

/**
 * Selector 工厂：按 id 读取单节点。
 * 场景：属性面板或快捷浮层读取指定节点。
 */
export const selectCardById =
    (nodeId: string) => (state: ConversationStoreState): ConversationCard | undefined =>
        state.activeThread.cards.find((node) => node.id === nodeId)

/**
 * Selector 工厂：读取某父节点的直接子节点。
 * 场景：从一张卡片展开追问分支列表。
 */
export const selectChildrenByParentId =
    (parentId: string) =>
        (state: ConversationStoreState): ConversationCard[] =>
            state.activeThread.cards.filter((node) => node.parentId === parentId)

/**
 * Selector：是否可撤销/重做。
 * 场景：Toolbar 上 Ctrl+Z / Ctrl+Y 按钮禁用态控制。
 */
export const selectCanUndo = (state: ConversationStoreState): boolean =>
    state.pastSnapshots.length > 0
export const selectCanRedo = (state: ConversationStoreState): boolean =>
    state.futureSnapshots.length > 0
