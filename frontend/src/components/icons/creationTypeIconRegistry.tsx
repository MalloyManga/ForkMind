import type { ComponentType } from "react"
import type { ConversationCreationIconKey } from "../../domain/conversation/nodeTypeRegistry"
import { ChatPlusIcon } from "./ChatPlusIcon"
import { NotePlusIcon } from "./NotePlusIcon"

/**
 * 创建模式图标注册表。
 * 业务场景：CanvasCreationModeBar 根据节点类型注册表里的 iconKey 动态取图标，
 * 后续新增卡片类型时，图标映射只维护这一处。
 */
export const CREATION_TYPE_ICON_REGISTRY: Record<
    ConversationCreationIconKey,
    ComponentType<{ className?: string }>
> = {
    chat: ChatPlusIcon,
    note: NotePlusIcon,
}
