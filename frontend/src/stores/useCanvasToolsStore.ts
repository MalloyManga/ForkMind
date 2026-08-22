import { create } from "zustand"
import type { CanvasTool } from "../hooks/canvasToolTypes"

interface CanvasToolsStoreState {
    currentCanvasTool: CanvasTool
    setCurrentCanvasTool: (currentCanvasTool: CanvasTool) => void
}

/**
 * 当前的画布工具 canvasTool
 */
export const useCanvasToolsStore = create<CanvasToolsStoreState>()((set) => ({
    currentCanvasTool: "move",
    setCurrentCanvasTool: (nextCanvasTool) => {
        set({
            currentCanvasTool: nextCanvasTool
        })
    }
}))
