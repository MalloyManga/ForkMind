import { getRootCards } from "../../domain/conversation/rules"
import type { ConversationCard } from "../../domain/conversation/types"
import type { ConversationStoreState } from "./contracts"

/**
 * 当前线程全部节点
 */
export const selectActiveThreadCards = (
    state: ConversationStoreState,
): ConversationCard[] => state.activeThread.cards

/**
 * 当前选中节点 id
 * 右侧编辑栏根据 activeNodeId 显示对应编辑表单
 */
export const selectActiveNodeId = (state: ConversationStoreState): string | null => state.activeNodeId

/**
 * 当前选中节点实体
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
 * 根节点集合数组
 */
export const selectRootCards = (state: ConversationStoreState): ConversationCard[] => getRootCards(state.activeThread.cards)

/**
 * 按 id 读取单节点
 */
export const selectCardById =
    (nodeId: string) => (state: ConversationStoreState): ConversationCard | undefined =>
        state.activeThread.cards.find((node) => node.id === nodeId)

/**
 * 读取某父节点的直接子节点
 */
export const selectChildrenByParentId =
    (parentId: string) =>
        (state: ConversationStoreState): ConversationCard[] =>
            state.activeThread.cards.filter((node) => node.parentId === parentId)

/**
 * 是否可撤销/重做
 * Toolbar 上 Ctrl+Z / Ctrl+Y 按钮禁用态控制
 */
export const selectCanUndo = (state: ConversationStoreState): boolean =>
    state.pastSnapshots.length > 0
export const selectCanRedo = (state: ConversationStoreState): boolean =>
    state.futureSnapshots.length > 0
