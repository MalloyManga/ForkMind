import { useEffect, useState } from "react"
import { ImageIcon } from "lucide-react"
import { readManagedAssetDataURLFromBridge } from "../bridge"
import { cn } from "../lib/utils"

interface ManagedImagePreviewProps {
    assetId: string
    altText: string
    className?: string
}

/**
 * 从 Go Bridge 读取本地管理图片并渲染临时 data URL
 * @param assetId 入参来自 ImageNode.asset.id 空字符串表示用户尚未选择图片
 * @param altText 入参来自 ImageNode.altText 用于无障碍描述
 * @param className 入参由画布卡片或右侧编辑器控制外层尺寸
 * @returns 返回图片 读取中占位或错误占位 不会把 data URL 写入 Store
 * Image 卡片在画布或右侧编辑器挂载时触发
 */
export function ManagedImagePreview({ assetId, altText, className }: ManagedImagePreviewProps) {
    const [dataUrl, setDataUrl] = useState<string | null>(null)
    const [errorMessage, setErrorMessage] = useState<string | null>(null)

    useEffect(() => {
        let isCurrentRequest = true
        setDataUrl(null)
        setErrorMessage(null)
        if (!assetId) {
            return () => {
                isCurrentRequest = false
            }
        }

        void readManagedAssetDataURLFromBridge(assetId).then((response) => {
            if (!isCurrentRequest) {
                return
            }
            if (response.error || !response.dataUrl) {
                setErrorMessage(response.error?.message ?? "本地图片不可用")
                return
            }
            setDataUrl(response.dataUrl)
        })

        return () => {
            isCurrentRequest = false
        }
    }, [assetId])

    if (dataUrl) {
        return (
            <img
                src={dataUrl}
                alt={altText}
                className={cn("h-full w-full object-contain", className)}
                draggable={false}
            />
        )
    }

    return (
        <div className={cn("flex h-full w-full flex-col items-center justify-center gap-2 bg-muted/40 text-muted-foreground", className)}>
            <ImageIcon className="h-7 w-7 opacity-50" />
            <span className="max-w-[85%] truncate text-[11px]">
                {errorMessage ?? (assetId ? "正在读取本地图片" : "尚未选择本地图片")}
            </span>
        </div>
    )
}
