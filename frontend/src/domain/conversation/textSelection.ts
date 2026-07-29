import type { ConversationTextAnchor } from "./types"

export const CANVAS_TEXT_SELECTION_EVENT = "forkmind:canvas-text-selection"
export const CANVAS_CARD_ACTIVATE_EVENT = "forkmind:canvas-card-activate"

export interface CanvasTextSelectionEventDetail {
    anchor: ConversationTextAnchor
    clientX: number
    clientY: number
}

export interface CanvasCardActivateEventDetail {
    nodeId: string
}
