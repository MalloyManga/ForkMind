package main

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

// TestWorkspaceRepositorySaveAndLoad 验证完整工作区可以拆分落盘并无损恢复
// repository 使用 t.TempDir 保证测试不会接触真实用户数据目录
func TestWorkspaceRepositorySaveAndLoad(t *testing.T) {
	t.Parallel()

	repository := NewWorkspaceRepository(t.TempDir())
	expectedDocument := createTestWorkspaceDocument()

	if err := repository.SaveWorkspace(expectedDocument); err != nil {
		t.Fatalf("SaveWorkspace() error = %v", err)
	}

	actualDocument, exists, err := repository.LoadWorkspace()
	if err != nil {
		t.Fatalf("LoadWorkspace() error = %v", err)
	}
	if !exists {
		t.Fatal("LoadWorkspace() exists = false, want true")
	}
	if actualDocument.ActiveThreadID != expectedDocument.ActiveThreadID {
		t.Fatalf("ActiveThreadID = %q, want %q", actualDocument.ActiveThreadID, expectedDocument.ActiveThreadID)
	}
	if len(actualDocument.Threads) != 1 {
		t.Fatalf("len(Threads) = %d, want 1", len(actualDocument.Threads))
	}
	if actualDocument.Threads[0].Cards[0].UserPrompt != "hello" {
		t.Fatalf("UserPrompt = %q, want hello", actualDocument.Threads[0].Cards[0].UserPrompt)
	}
}

// TestWorkspaceRepositoryRecoversThreadFromBackup 验证主 thread JSON 损坏时自动读取上一版备份
// 两次保存会生成 .bak 随后故意破坏主文件以覆盖真实崩溃恢复路径
func TestWorkspaceRepositoryRecoversThreadFromBackup(t *testing.T) {
	t.Parallel()

	repository := NewWorkspaceRepository(t.TempDir())
	firstDocument := createTestWorkspaceDocument()
	firstDocument.Threads[0].Title = "first version"
	if err := repository.SaveWorkspace(firstDocument); err != nil {
		t.Fatalf("first SaveWorkspace() error = %v", err)
	}

	secondDocument := createTestWorkspaceDocument()
	secondDocument.Threads[0].Title = "second version"
	if err := repository.SaveWorkspace(secondDocument); err != nil {
		t.Fatalf("second SaveWorkspace() error = %v", err)
	}

	threadPath := filepath.Join(
		repository.RootDir(),
		threadsDirectoryName,
		buildThreadFileName(firstDocument.Threads[0].ID),
	)
	if err := os.WriteFile(threadPath, []byte("{broken"), 0o600); err != nil {
		t.Fatalf("corrupt thread file: %v", err)
	}

	loadedDocument, exists, err := repository.LoadWorkspace()
	if err != nil {
		t.Fatalf("LoadWorkspace() error = %v", err)
	}
	if !exists {
		t.Fatal("LoadWorkspace() exists = false, want true")
	}
	if loadedDocument.Threads[0].Title != "first version" {
		t.Fatalf("recovered title = %q, want first version", loadedDocument.Threads[0].Title)
	}
}

// TestWorkspaceRepositoryRemovesStaleThreadFiles 验证删除会话后旧主文件不会继续残留
// .bak 保留策略不在该断言范围 因为备份用于用户人工恢复
func TestWorkspaceRepositoryRemovesStaleThreadFiles(t *testing.T) {
	t.Parallel()

	repository := NewWorkspaceRepository(t.TempDir())
	document := createTestWorkspaceDocument()
	secondThread := document.Threads[0]
	secondThread.ID = "thread-2"
	secondThread.Title = "second"
	document.Threads = append(document.Threads, secondThread)

	if err := repository.SaveWorkspace(document); err != nil {
		t.Fatalf("SaveWorkspace(two threads) error = %v", err)
	}

	stalePath := filepath.Join(
		repository.RootDir(),
		threadsDirectoryName,
		buildThreadFileName(secondThread.ID),
	)
	document.Threads = document.Threads[:1]
	if err := repository.SaveWorkspace(document); err != nil {
		t.Fatalf("SaveWorkspace(one thread) error = %v", err)
	}

	if _, err := os.Stat(stalePath); !os.IsNotExist(err) {
		t.Fatalf("stale thread os.Stat() error = %v, want file not exist", err)
	}
}

// TestValidateWorkspaceDocumentRejectsParentCycle 验证后端不会接受成环父链
// 即使前端边界被绕过 Repository 仍必须在写盘前拒绝损坏领域数据
func TestValidateWorkspaceDocumentRejectsParentCycle(t *testing.T) {
	t.Parallel()

	document := createTestWorkspaceDocument()
	secondCard := document.Threads[0].Cards[0]
	secondCard.ID = "node-2"
	firstParentID := secondCard.ID
	secondParentID := document.Threads[0].Cards[0].ID
	document.Threads[0].Cards[0].ParentID = &firstParentID
	secondCard.ParentID = &secondParentID
	document.Threads[0].Cards = append(document.Threads[0].Cards, secondCard)

	if err := validateWorkspaceDocument(document); err == nil {
		t.Fatal("validateWorkspaceDocument() error = nil, want parent cycle error")
	}
}

// createTestWorkspaceDocument 生成 Repository 测试共用的最小合法工作区
// 返回值每次都是独立对象 测试可以安全修改而不会互相污染
func createTestWorkspaceDocument() WorkspaceDocumentDTO {
	now := time.Date(2026, time.July, 25, 12, 0, 0, 0, time.UTC).Format(time.RFC3339Nano)
	return WorkspaceDocumentDTO{
		Format:         workspaceFormat,
		Version:        workspaceVersion,
		ActiveThreadID: "thread-1",
		LastModified:   now,
		Settings: PersistedOpenAISettingsDTO{
			BaseURL:      "http://localhost:11434/v1",
			Model:        "test-model",
			SystemPrompt: "test system prompt",
			Temperature:  0.7,
			MaxTokens:    1024,
		},
		Threads: []ConversationThreadDTO{
			{
				ID:        "thread-1",
				Title:     "test thread",
				CreatedAt: now,
				UpdatedAt: now,
				Cards: []ConversationCardDTO{
					{
						ID:         "node-1",
						CardType:   "chat",
						ParentID:   nil,
						Position:   CardPositionDTO{X: 10, Y: 20},
						Size:       CardSizeDTO{Mode: "auto", Width: 360, MinHeight: 160},
						Status:     "done",
						CreatedAt:  now,
						UpdatedAt:  now,
						UserPrompt: "hello",
						AIResponse: "world",
					},
				},
			},
		},
	}
}
