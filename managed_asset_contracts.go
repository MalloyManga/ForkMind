package main

const (
	managedAssetKindImage = "image"
	managedAssetKindFile  = "file"
)

// ManagedAssetDTO 是 React 节点保存的本地资产稳定元数据
// ID 是工作区 assets 目录中的内容哈希文件名 Name 保留用户原始文件名用于展示
type ManagedAssetDTO struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	MimeType  string `json:"mimeType"`
	SizeBytes int64  `json:"sizeBytes"`
}

// ManagedAssetImportResponse 返回系统文件选择和本地复制结果
// Cancelled=true 表示用户主动关闭对话框 Asset 非 nil 表示复制或去重命中成功
type ManagedAssetImportResponse struct {
	Cancelled bool             `json:"cancelled"`
	Asset     *ManagedAssetDTO `json:"asset,omitempty"`
	Error     *BridgeError     `json:"error,omitempty"`
}

// ManagedAssetDataResponse 返回图片预览使用的 data URL
// DataURL 只在调用期间进入渲染进程 不会写回 Workspace JSON
type ManagedAssetDataResponse struct {
	DataURL string       `json:"dataUrl,omitempty"`
	Error   *BridgeError `json:"error,omitempty"`
}
