package main

import (
	"errors"
	"path/filepath"
	"testing"
)

// TestWorkspaceBridgeInitializationFailures 验证三个工作区 Bridge 统一暴露初始化错误
// 前端据此阻止保存并展示不可重试的本地环境错误
func TestWorkspaceBridgeInitializationFailures(t *testing.T) {
	t.Parallel()

	app := &App{initializationError: errors.New("config unavailable")}
	assertBridgeErrorCode(t, app.LoadWorkspace().Error, errorCodeInternal)
	assertBridgeErrorCode(t, app.SaveWorkspace(createTestWorkspaceDocument()).Error, errorCodeInternal)
	assertBridgeErrorCode(t, app.GetDataDirectory().Error, errorCodeInternal)
}

// TestWorkspaceBridgeRejectsMissingRepository 验证依赖缺失不会触发 nil 指针
// 该分支保护构造失败或测试注入错误时的 Wails Bridge 边界
func TestWorkspaceBridgeRejectsMissingRepository(t *testing.T) {
	t.Parallel()

	app := &App{}
	assertBridgeErrorCode(t, app.LoadWorkspace().Error, errorCodeInternal)
	assertBridgeErrorCode(t, app.SaveWorkspace(createTestWorkspaceDocument()).Error, errorCodeInternal)
	assertBridgeErrorCode(t, app.GetDataDirectory().Error, errorCodeInternal)
}

// TestWorkspaceBridgeSaveLoadAndDirectory 验证 Bridge 通过 Repository 完成首次读取 保存和恢复
// 使用临时目录保证不会访问真实 ForkMind 用户数据
func TestWorkspaceBridgeSaveLoadAndDirectory(t *testing.T) {
	t.Parallel()

	rootDir := filepath.Join(t.TempDir(), "ForkMind")
	app := &App{workspaceRepository: NewWorkspaceRepository(rootDir)}

	missingResponse := app.LoadWorkspace()
	if missingResponse.Error != nil || missingResponse.Exists {
		t.Fatalf("first LoadWorkspace() = %#v, want missing workspace without error", missingResponse)
	}

	document := createTestWorkspaceDocument()
	if response := app.SaveWorkspace(document); response.Error != nil {
		t.Fatalf("SaveWorkspace() error = %#v", response.Error)
	}

	loadResponse := app.LoadWorkspace()
	if loadResponse.Error != nil || !loadResponse.Exists || loadResponse.Workspace == nil {
		t.Fatalf("LoadWorkspace() = %#v, want saved document", loadResponse)
	}
	if loadResponse.Workspace.ActiveThreadID != document.ActiveThreadID {
		t.Fatalf("ActiveThreadID = %q, want %q", loadResponse.Workspace.ActiveThreadID, document.ActiveThreadID)
	}

	directoryResponse := app.GetDataDirectory()
	if directoryResponse.Error != nil || directoryResponse.Path != rootDir {
		t.Fatalf("GetDataDirectory() = %#v, want %q", directoryResponse, rootDir)
	}
}

// TestWorkspaceBridgeMapsRepositoryErrors 验证磁盘读取和领域写入错误使用稳定错误码
func TestWorkspaceBridgeMapsRepositoryErrors(t *testing.T) {
	t.Parallel()

	rootDir := t.TempDir()
	app := &App{workspaceRepository: NewWorkspaceRepository(rootDir)}
	if err := writeJSONAtomically(filepath.Join(rootDir, workspaceIndexFileName), map[string]string{"invalid": "index"}); err != nil {
		t.Fatalf("write invalid index: %v", err)
	}
	assertBridgeErrorCode(t, app.LoadWorkspace().Error, errorCodeReadFailed)

	invalidDocument := createTestWorkspaceDocument()
	invalidDocument.Format = "invalid"
	assertBridgeErrorCode(t, app.SaveWorkspace(invalidDocument).Error, errorCodeWriteFailed)
}

// assertBridgeErrorCode 检查 BridgeError 非空且具有预期稳定错误码
func assertBridgeErrorCode(t *testing.T, bridgeError *BridgeError, expectedCode string) {
	t.Helper()
	if bridgeError == nil || bridgeError.Code != expectedCode {
		t.Fatalf("BridgeError = %#v, want code %q", bridgeError, expectedCode)
	}
}
