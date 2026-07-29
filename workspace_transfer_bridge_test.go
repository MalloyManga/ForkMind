package main

import (
	"context"
	"errors"
	"math"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// TestEnsureJSONFileExtension 验证保存对话框未提供扩展名时会补全 json
func TestEnsureJSONFileExtension(t *testing.T) {
	t.Parallel()

	if actual := ensureJSONFileExtension("workspace"); actual != "workspace.json" {
		t.Fatalf("expected workspace.json, got %q", actual)
	}
	if actual := ensureJSONFileExtension("workspace.json"); actual != "workspace.json" {
		t.Fatalf("expected existing extension to remain unchanged, got %q", actual)
	}
	if actual := ensureJSONFileExtension("workspace.JSON"); actual != "workspace.JSON" {
		t.Fatalf("expected case-insensitive extension to remain unchanged, got %q", actual)
	}
}

// TestWorkspaceTransferFileHelpers 验证导出编码与受限导入可以完成单文件往返
func TestWorkspaceTransferFileHelpers(t *testing.T) {
	t.Parallel()

	document := createTestWorkspaceDocument()
	filePath := filepath.Join(t.TempDir(), "workspace.json")
	if err := writeWorkspaceExportFile(filePath, workspaceExportDocumentDTO{WorkspaceDocumentDTO: document}); err != nil {
		t.Fatalf("write export: %v", err)
	}

	content, err := readWorkspaceImportFile(filePath, workspaceTransferMaxBytes)
	if err != nil {
		t.Fatalf("read import: %v", err)
	}
	if !strings.Contains(content, `"format": "forkmind-workspace"`) {
		t.Fatalf("export content does not contain workspace format: %s", content)
	}
}

// TestReadWorkspaceImportFileRejectsOversizedFile 验证异常大文件不会进入前端内存
func TestReadWorkspaceImportFileRejectsOversizedFile(t *testing.T) {
	t.Parallel()

	filePath := filepath.Join(t.TempDir(), "oversized.json")
	if err := os.WriteFile(filePath, []byte("12345"), 0o600); err != nil {
		t.Fatalf("write fixture: %v", err)
	}

	if _, err := readWorkspaceImportFile(filePath, 4); err == nil {
		t.Fatal("expected oversized import to fail")
	}
}

// TestWorkspaceTransferBridgeRequiresContext 验证系统对话框调用前必须存在 Wails context
func TestWorkspaceTransferBridgeRequiresContext(t *testing.T) {
	t.Parallel()

	app := &App{}
	assertBridgeErrorCode(t, app.ExportWorkspace(createTestWorkspaceDocument()).Error, errorCodeInternal)
	assertBridgeErrorCode(t, app.ImportWorkspace().Error, errorCodeInternal)
}

// TestExportWorkspaceBridgeScenarios 验证导出校验 对话框取消 错误 写入失败和成功路径
// SaveFileDialog 通过运行端口替换 因此测试不会打开真实系统窗口
func TestExportWorkspaceBridgeScenarios(t *testing.T) {
	previousDialog := showWorkspaceSaveDialog
	defer func() { showWorkspaceSaveDialog = previousDialog }()

	app := &App{ctx: context.Background(), workspaceRepository: NewWorkspaceRepository(t.TempDir())}
	invalidDocument := createTestWorkspaceDocument()
	invalidDocument.Format = "invalid"
	assertBridgeErrorCode(t, app.ExportWorkspace(invalidDocument).Error, errorCodeInvalidData)

	showWorkspaceSaveDialog = func(context.Context, runtime.SaveDialogOptions) (string, error) {
		return "", errors.New("dialog failed")
	}
	assertBridgeErrorCode(t, app.ExportWorkspace(createTestWorkspaceDocument()).Error, errorCodeWriteFailed)

	showWorkspaceSaveDialog = func(context.Context, runtime.SaveDialogOptions) (string, error) {
		return "", nil
	}
	if response := app.ExportWorkspace(createTestWorkspaceDocument()); !response.Cancelled || response.Error != nil {
		t.Fatalf("cancelled ExportWorkspace() = %#v", response)
	}

	blockedPath := filepath.Join(t.TempDir(), "blocked.json")
	if err := os.Mkdir(blockedPath, 0o755); err != nil {
		t.Fatalf("create blocked export directory: %v", err)
	}
	showWorkspaceSaveDialog = func(context.Context, runtime.SaveDialogOptions) (string, error) {
		return blockedPath, nil
	}
	assertBridgeErrorCode(t, app.ExportWorkspace(createTestWorkspaceDocument()).Error, errorCodeWriteFailed)

	exportPathWithoutExtension := filepath.Join(t.TempDir(), "workspace")
	showWorkspaceSaveDialog = func(_ context.Context, dialogOptions runtime.SaveDialogOptions) (string, error) {
		if dialogOptions.DefaultFilename != workspaceExportDefaultFileName {
			t.Errorf("DefaultFilename = %q", dialogOptions.DefaultFilename)
		}
		return exportPathWithoutExtension, nil
	}
	response := app.ExportWorkspace(createTestWorkspaceDocument())
	if response.Error != nil || response.Path != exportPathWithoutExtension+".json" {
		t.Fatalf("successful ExportWorkspace() = %#v", response)
	}
	if _, err := os.Stat(response.Path); err != nil {
		t.Fatalf("exported file stat: %v", err)
	}
}

// TestImportWorkspaceBridgeScenarios 验证导入对话框取消 错误 文件错误和成功路径
// Bridge 只返回原始文本 领域校验仍由 React 导入流程负责
func TestImportWorkspaceBridgeScenarios(t *testing.T) {
	previousDialog := showWorkspaceOpenDialog
	defer func() { showWorkspaceOpenDialog = previousDialog }()

	app := &App{ctx: context.Background(), workspaceRepository: NewWorkspaceRepository(t.TempDir())}
	showWorkspaceOpenDialog = func(context.Context, runtime.OpenDialogOptions) (string, error) {
		return "", errors.New("dialog failed")
	}
	assertBridgeErrorCode(t, app.ImportWorkspace().Error, errorCodeReadFailed)

	showWorkspaceOpenDialog = func(context.Context, runtime.OpenDialogOptions) (string, error) {
		return "", nil
	}
	if response := app.ImportWorkspace(); !response.Cancelled || response.Error != nil {
		t.Fatalf("cancelled ImportWorkspace() = %#v", response)
	}

	missingPath := filepath.Join(t.TempDir(), "missing.json")
	showWorkspaceOpenDialog = func(context.Context, runtime.OpenDialogOptions) (string, error) {
		return missingPath, nil
	}
	assertBridgeErrorCode(t, app.ImportWorkspace().Error, errorCodeReadFailed)

	importPath := filepath.Join(t.TempDir(), "workspace.json")
	if err := writeWorkspaceExportFile(importPath, workspaceExportDocumentDTO{
		WorkspaceDocumentDTO: createTestWorkspaceDocument(),
	}); err != nil {
		t.Fatalf("write import fixture: %v", err)
	}
	showWorkspaceOpenDialog = func(_ context.Context, dialogOptions runtime.OpenDialogOptions) (string, error) {
		if dialogOptions.Title == "" || len(dialogOptions.Filters) == 0 {
			t.Errorf("OpenDialogOptions = %#v", dialogOptions)
		}
		return importPath, nil
	}
	response := app.ImportWorkspace()
	if response.Error != nil || response.Path != importPath || !strings.Contains(response.Content, "forkmind-workspace") {
		t.Fatalf("successful ImportWorkspace() = %#v", response)
	}
}

// TestWorkspaceTransferFileHelperErrors 验证导出编码和导入文本边界错误
func TestWorkspaceTransferFileHelperErrors(t *testing.T) {
	t.Parallel()

	invalidDocument := createTestWorkspaceDocument()
	invalidDocument.Settings.Temperature = math.NaN()
	if err := writeWorkspaceExportFile(
		filepath.Join(t.TempDir(), "invalid.json"),
		workspaceExportDocumentDTO{WorkspaceDocumentDTO: invalidDocument},
	); err == nil {
		t.Fatal("writeWorkspaceExportFile() error = nil for NaN")
	}

	emptyPath := filepath.Join(t.TempDir(), "empty.json")
	if err := os.WriteFile(emptyPath, nil, 0o600); err != nil {
		t.Fatalf("write empty fixture: %v", err)
	}
	if _, err := readWorkspaceImportFile(emptyPath, 10); err == nil || !strings.Contains(err.Error(), "empty") {
		t.Fatalf("empty import error = %v", err)
	}

	invalidUTF8Path := filepath.Join(t.TempDir(), "invalid-utf8.json")
	if err := os.WriteFile(invalidUTF8Path, []byte{0xff, 0xfe}, 0o600); err != nil {
		t.Fatalf("write invalid UTF-8 fixture: %v", err)
	}
	if _, err := readWorkspaceImportFile(invalidUTF8Path, 10); err == nil || !strings.Contains(err.Error(), "UTF-8") {
		t.Fatalf("invalid UTF-8 import error = %v", err)
	}
}
