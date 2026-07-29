package main

import (
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"unicode/utf8"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

const (
	workspaceExportDefaultFileName = "ForkMind-workspace.json"
	workspaceTransferMaxBytes      = 32 * 1024 * 1024
)

var workspaceJSONFilters = []runtime.FileFilter{
	{
		DisplayName: "ForkMind Workspace (*.json)",
		Pattern:     "*.json",
	},
}

// ExportWorkspace 通过系统保存对话框导出单文件工作区 JSON
// document 来自 React 当前 workspaceStore 与 conversationStore 的同步快照
// 返回 Cancelled=true 表示用户关闭对话框 成功时 Path 是最终写入位置
// 用户点击左侧栏 Export 时触发 API Key 不属于 document 因此不会进入导出文件
func (a *App) ExportWorkspace(document WorkspaceDocumentDTO) WorkspaceExportResponse {
	if a.ctx == nil {
		return WorkspaceExportResponse{
			Error: newBridgeError(errorCodeInternal, fmt.Errorf("application context is unavailable"), false),
		}
	}
	if err := validateWorkspaceDocument(document); err != nil {
		return WorkspaceExportResponse{
			Error: newBridgeError(errorCodeInvalidData, fmt.Errorf("validate export workspace: %w", err), false),
		}
	}

	selectedPath, err := showWorkspaceSaveDialog(a.ctx, runtime.SaveDialogOptions{
		Title:                "Export ForkMind Workspace",
		DefaultFilename:      workspaceExportDefaultFileName,
		Filters:              workspaceJSONFilters,
		CanCreateDirectories: true,
	})
	if err != nil {
		return WorkspaceExportResponse{
			Error: newBridgeError(errorCodeWriteFailed, fmt.Errorf("open export dialog: %w", err), true),
		}
	}
	if selectedPath == "" {
		return WorkspaceExportResponse{Cancelled: true}
	}

	exportPath := ensureJSONFileExtension(selectedPath)
	if err := writeWorkspaceExportFile(exportPath, document); err != nil {
		return WorkspaceExportResponse{
			Error: newBridgeError(errorCodeWriteFailed, err, true),
		}
	}

	return WorkspaceExportResponse{Path: exportPath}
}

// ImportWorkspace 通过系统打开对话框读取单文件工作区 JSON 文本
// 返回 Content 只是外部输入边界 不代表已经通过业务校验
// 用户点击左侧栏 Import 并选择文件时触发 文件大小限制用于避免异常文件占满内存
func (a *App) ImportWorkspace() WorkspaceImportResponse {
	if a.ctx == nil {
		return WorkspaceImportResponse{
			Error: newBridgeError(errorCodeInternal, fmt.Errorf("application context is unavailable"), false),
		}
	}

	selectedPath, err := showWorkspaceOpenDialog(a.ctx, runtime.OpenDialogOptions{
		Title:   "Import ForkMind Workspace",
		Filters: workspaceJSONFilters,
	})
	if err != nil {
		return WorkspaceImportResponse{
			Error: newBridgeError(errorCodeReadFailed, fmt.Errorf("open import dialog: %w", err), true),
		}
	}
	if selectedPath == "" {
		return WorkspaceImportResponse{Cancelled: true}
	}

	content, err := readWorkspaceImportFile(selectedPath, workspaceTransferMaxBytes)
	if err != nil {
		return WorkspaceImportResponse{
			Error: newBridgeError(errorCodeReadFailed, err, false),
		}
	}

	return WorkspaceImportResponse{
		Path:    selectedPath,
		Content: content,
	}
}

// ensureJSONFileExtension 保证导出文件拥有 json 扩展名
// selectedPath 来自系统保存对话框 返回值用于实际写入和 UI 成功提示
// 用户未手动输入扩展名时触发 已有任意大小写 json 扩展名时保持原路径
func ensureJSONFileExtension(selectedPath string) string {
	if strings.EqualFold(filepath.Ext(selectedPath), ".json") {
		return selectedPath
	}

	return selectedPath + ".json"
}

// writeWorkspaceExportFile 编码并写入可独立迁移的完整工作区 JSON
// filePath 来自系统保存对话框 document 已在 Bridge 入口完成领域校验
// 返回 nil 表示文件已经完成写入 非 nil 错误会被 Bridge 转换为 write_failed
// ExportWorkspace 获得用户明确目标路径后触发
func writeWorkspaceExportFile(filePath string, document WorkspaceDocumentDTO) error {
	encodedDocument, err := json.MarshalIndent(document, "", "  ")
	if err != nil {
		return fmt.Errorf("encode workspace export: %w", err)
	}
	encodedDocument = append(encodedDocument, '\n')

	if err := os.WriteFile(filePath, encodedDocument, 0o600); err != nil {
		return fmt.Errorf("write workspace export: %w", err)
	}

	return nil
}

// readWorkspaceImportFile 受限读取外部工作区文本
// filePath 来自系统打开对话框 maxBytes 是允许进入前端验证器的最大字节数
// 返回 UTF-8 JSON 原文 空文件 超限文件和无效 UTF-8 都会返回明确错误
// ImportWorkspace 在用户选择文件后触发
func readWorkspaceImportFile(filePath string, maxBytes int64) (content string, returnErr error) {
	file, err := os.Open(filePath)
	if err != nil {
		return "", fmt.Errorf("open workspace import: %w", err)
	}
	defer func() {
		if closeErr := file.Close(); closeErr != nil && returnErr == nil {
			returnErr = fmt.Errorf("close workspace import: %w", closeErr)
		}
	}()

	fileInfo, err := file.Stat()
	if err != nil {
		return "", fmt.Errorf("inspect workspace import: %w", err)
	}
	if fileInfo.Size() > maxBytes {
		return "", fmt.Errorf("workspace import exceeds %d bytes", maxBytes)
	}

	encodedContent, err := io.ReadAll(io.LimitReader(file, maxBytes+1))
	if err != nil {
		return "", fmt.Errorf("read workspace import: %w", err)
	}
	if int64(len(encodedContent)) > maxBytes {
		return "", fmt.Errorf("workspace import exceeds %d bytes", maxBytes)
	}
	if len(encodedContent) == 0 {
		return "", fmt.Errorf("workspace import is empty")
	}
	if !utf8.Valid(encodedContent) {
		return "", fmt.Errorf("workspace import must be valid UTF-8")
	}

	return string(encodedContent), nil
}
