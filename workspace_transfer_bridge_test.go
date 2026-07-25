package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
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
}

// TestWorkspaceTransferFileHelpers 验证导出编码与受限导入可以完成单文件往返
func TestWorkspaceTransferFileHelpers(t *testing.T) {
	t.Parallel()

	document := createTestWorkspaceDocument()
	filePath := filepath.Join(t.TempDir(), "workspace.json")
	if err := writeWorkspaceExportFile(filePath, document); err != nil {
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
