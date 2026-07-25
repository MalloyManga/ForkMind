package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
)

const (
	workspaceIndexFileName = "workspace.json"
	threadsDirectoryName   = "threads"
)

type workspaceThreadIndexEntry struct {
	ID        string `json:"id"`
	Title     string `json:"title"`
	File      string `json:"file"`
	CreatedAt string `json:"createdAt"`
	UpdatedAt string `json:"updatedAt"`
}

type workspaceIndexDocument struct {
	Format         string                      `json:"format"`
	Version        string                      `json:"version"`
	ActiveThreadID string                      `json:"activeThreadId"`
	Threads        []workspaceThreadIndexEntry `json:"threads"`
	Settings       PersistedOpenAISettingsDTO  `json:"settings"`
	LastModified   string                      `json:"lastModified"`
}

type threadFileDocument struct {
	Format  string                `json:"format"`
	Version string                `json:"version"`
	Thread  ConversationThreadDTO `json:"thread"`
}

// WorkspaceRepository 管理 ForkMind 本地工作区文件
// rootDir 通常位于 os.UserConfigDir/ForkMind 测试中可以注入临时目录
type WorkspaceRepository struct {
	rootDir string
}

// NewDefaultWorkspaceRepository 创建生产环境 Repository
// 返回错误表示操作系统没有提供可用的用户配置目录 调用方必须通过 Bridge 返回该错误
func NewDefaultWorkspaceRepository() (*WorkspaceRepository, error) {
	userConfigDir, err := os.UserConfigDir()
	if err != nil {
		return nil, fmt.Errorf("resolve user config directory: %w", err)
	}

	return NewWorkspaceRepository(filepath.Join(userConfigDir, "ForkMind")), nil
}

// NewWorkspaceRepository 使用明确目录创建 Repository
// rootDir 来自默认配置目录或测试临时目录 返回值不会主动创建磁盘目录
func NewWorkspaceRepository(rootDir string) *WorkspaceRepository {
	return &WorkspaceRepository{rootDir: filepath.Clean(rootDir)}
}

// RootDir 返回当前 Repository 数据目录
// 设置页展示路径与测试断言会读取该值 不允许调用方拼接内部文件结构
func (repository *WorkspaceRepository) RootDir() string {
	return repository.rootDir
}

// SaveWorkspace 保存完整工作区快照
// document 来自 React workspaceStore 先校验所有 Thread 再写 thread 文件 最后提交 workspace index
// 返回 nil 表示 index 与全部 thread 文件已经成功落盘
func (repository *WorkspaceRepository) SaveWorkspace(document WorkspaceDocumentDTO) error {
	if err := validateWorkspaceDocument(document); err != nil {
		return fmt.Errorf("validate workspace before save: %w", err)
	}

	threadsDir := filepath.Join(repository.rootDir, threadsDirectoryName)
	if err := os.MkdirAll(threadsDir, 0o755); err != nil {
		return fmt.Errorf("create workspace directories: %w", err)
	}

	desiredThreadFiles := make(map[string]struct{}, len(document.Threads))
	threadEntries := make([]workspaceThreadIndexEntry, 0, len(document.Threads))
	for _, thread := range document.Threads {
		threadFileName := buildThreadFileName(thread.ID)
		threadFilePath := filepath.Join(threadsDir, threadFileName)
		threadDocument := threadFileDocument{
			Format:  threadFileFormat,
			Version: workspaceVersion,
			Thread:  thread,
		}

		if err := writeJSONAtomically(threadFilePath, threadDocument); err != nil {
			return fmt.Errorf("save thread %q: %w", thread.ID, err)
		}

		desiredThreadFiles[threadFileName] = struct{}{}
		threadEntries = append(threadEntries, workspaceThreadIndexEntry{
			ID:        thread.ID,
			Title:     thread.Title,
			File:      filepath.ToSlash(filepath.Join(threadsDirectoryName, threadFileName)),
			CreatedAt: thread.CreatedAt,
			UpdatedAt: thread.UpdatedAt,
		})
	}

	indexDocument := workspaceIndexDocument{
		Format:         workspaceFormat,
		Version:        workspaceVersion,
		ActiveThreadID: document.ActiveThreadID,
		Threads:        threadEntries,
		Settings:       document.Settings,
		LastModified:   document.LastModified,
	}
	indexPath := filepath.Join(repository.rootDir, workspaceIndexFileName)
	if err := writeJSONAtomically(indexPath, indexDocument); err != nil {
		return fmt.Errorf("save workspace index: %w", err)
	}

	if err := removeStaleThreadFiles(threadsDir, desiredThreadFiles); err != nil {
		return fmt.Errorf("remove stale thread files: %w", err)
	}

	return nil
}

// LoadWorkspace 读取并重组完整工作区快照
// 主文件损坏或缺失时自动尝试同路径 .bak 文件
// exists 为 false 且 error 为 nil 表示首次启动没有本地工作区
func (repository *WorkspaceRepository) LoadWorkspace() (document WorkspaceDocumentDTO, exists bool, err error) {
	indexPath := filepath.Join(repository.rootDir, workspaceIndexFileName)
	indexDocument, indexExists, err := readJSONWithBackup[workspaceIndexDocument](indexPath)
	if err != nil {
		return WorkspaceDocumentDTO{}, false, fmt.Errorf("load workspace index: %w", err)
	}
	if !indexExists {
		return WorkspaceDocumentDTO{}, false, nil
	}
	if indexDocument.Format != workspaceFormat {
		return WorkspaceDocumentDTO{}, false, fmt.Errorf("workspace index format %q is invalid", indexDocument.Format)
	}
	if indexDocument.Version != workspaceVersion {
		return WorkspaceDocumentDTO{}, false, fmt.Errorf("workspace index version %q is unsupported", indexDocument.Version)
	}

	threads := make([]ConversationThreadDTO, 0, len(indexDocument.Threads))
	for entryIndex, threadEntry := range indexDocument.Threads {
		threadPath, err := repository.resolveIndexedThreadPath(threadEntry.File)
		if err != nil {
			return WorkspaceDocumentDTO{}, false, fmt.Errorf("threads[%d]: %w", entryIndex, err)
		}

		threadDocument, threadExists, err := readJSONWithBackup[threadFileDocument](threadPath)
		if err != nil {
			return WorkspaceDocumentDTO{}, false, fmt.Errorf("load thread %q: %w", threadEntry.ID, err)
		}
		if !threadExists {
			return WorkspaceDocumentDTO{}, false, fmt.Errorf("thread %q file is missing", threadEntry.ID)
		}
		if threadDocument.Format != threadFileFormat || threadDocument.Version != workspaceVersion {
			return WorkspaceDocumentDTO{}, false, fmt.Errorf("thread %q file header is invalid", threadEntry.ID)
		}
		if threadDocument.Thread.ID != threadEntry.ID {
			return WorkspaceDocumentDTO{}, false, fmt.Errorf("thread index id %q does not match file id %q", threadEntry.ID, threadDocument.Thread.ID)
		}

		threads = append(threads, threadDocument.Thread)
	}

	workspace := WorkspaceDocumentDTO{
		Format:         indexDocument.Format,
		Version:        indexDocument.Version,
		ActiveThreadID: indexDocument.ActiveThreadID,
		Threads:        threads,
		Settings:       indexDocument.Settings,
		LastModified:   indexDocument.LastModified,
	}
	if err := validateWorkspaceDocument(workspace); err != nil {
		return WorkspaceDocumentDTO{}, false, fmt.Errorf("validate loaded workspace: %w", err)
	}

	return workspace, true, nil
}

// resolveIndexedThreadPath 把 index 中的相对路径解析到 Repository 根目录
// 返回错误表示外部文件尝试通过 .. 或绝对路径越出 ForkMind 数据目录
func (repository *WorkspaceRepository) resolveIndexedThreadPath(indexedPath string) (string, error) {
	if indexedPath == "" {
		return "", fmt.Errorf("thread file path cannot be empty")
	}
	if filepath.IsAbs(indexedPath) {
		return "", fmt.Errorf("thread file path must be relative")
	}

	resolvedPath := filepath.Clean(filepath.Join(repository.rootDir, filepath.FromSlash(indexedPath)))
	rootWithSeparator := repository.rootDir + string(os.PathSeparator)
	if resolvedPath != repository.rootDir && !strings.HasPrefix(resolvedPath, rootWithSeparator) {
		return "", fmt.Errorf("thread file path escapes workspace directory")
	}

	return resolvedPath, nil
}

// buildThreadFileName 使用 Thread id 的 SHA-256 生成安全文件名
// 原始 id 不直接进入路径 从根源避免斜杠 冒号和路径穿越问题
func buildThreadFileName(threadID string) string {
	digest := sha256.Sum256([]byte(threadID))
	return hex.EncodeToString(digest[:]) + ".json"
}

// writeJSONAtomically 写入缩进 JSON 并保留上一版 .bak
// 写入流程是 temp -> current rename to backup -> temp rename to current
// 任一步失败都会尝试恢复旧主文件并返回清晰错误
func writeJSONAtomically(targetPath string, value any) (returnErr error) {
	encodedJSON, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return fmt.Errorf("encode JSON: %w", err)
	}
	encodedJSON = append(encodedJSON, '\n')

	targetDir := filepath.Dir(targetPath)
	if err := os.MkdirAll(targetDir, 0o755); err != nil {
		return fmt.Errorf("create target directory: %w", err)
	}

	temporaryFile, err := os.CreateTemp(targetDir, ".forkmind-*.tmp")
	if err != nil {
		return fmt.Errorf("create temporary file: %w", err)
	}
	temporaryPath := temporaryFile.Name()
	defer func() {
		removeErr := os.Remove(temporaryPath)
		if removeErr != nil && !errors.Is(removeErr, os.ErrNotExist) && returnErr == nil {
			returnErr = fmt.Errorf("remove temporary file: %w", removeErr)
		}
	}()

	if _, err := temporaryFile.Write(encodedJSON); err != nil {
		if closeErr := temporaryFile.Close(); closeErr != nil {
			return fmt.Errorf("write temporary file: %v; close temporary file: %w", err, closeErr)
		}
		return fmt.Errorf("write temporary file: %w", err)
	}
	if err := temporaryFile.Sync(); err != nil {
		if closeErr := temporaryFile.Close(); closeErr != nil {
			return fmt.Errorf("sync temporary file: %v; close temporary file: %w", err, closeErr)
		}
		return fmt.Errorf("sync temporary file: %w", err)
	}
	if err := temporaryFile.Close(); err != nil {
		return fmt.Errorf("close temporary file: %w", err)
	}

	backupPath := targetPath + ".bak"
	if _, err := os.Stat(targetPath); err == nil {
		if err := os.Remove(backupPath); err != nil && !errors.Is(err, os.ErrNotExist) {
			return fmt.Errorf("remove previous backup: %w", err)
		}
		if err := os.Rename(targetPath, backupPath); err != nil {
			return fmt.Errorf("move current file to backup: %w", err)
		}
	} else if !errors.Is(err, os.ErrNotExist) {
		return fmt.Errorf("inspect current file: %w", err)
	}

	if err := os.Rename(temporaryPath, targetPath); err != nil {
		if _, backupErr := os.Stat(backupPath); backupErr == nil {
			if restoreErr := os.Rename(backupPath, targetPath); restoreErr != nil {
				return fmt.Errorf("promote temporary file: %v; restore backup: %w", err, restoreErr)
			}
		} else if !errors.Is(backupErr, os.ErrNotExist) {
			return fmt.Errorf("promote temporary file: %v; inspect backup: %w", err, backupErr)
		}
		return fmt.Errorf("promote temporary file: %w", err)
	}

	return nil
}

// readJSONWithBackup 读取 JSON 主文件并在失败时尝试 .bak
// exists 为 false 表示主文件和备份都不存在 其它解码或读取错误必须返回
func readJSONWithBackup[T any](targetPath string) (value T, exists bool, err error) {
	mainValue, mainExists, mainErr := readJSONFile[T](targetPath)
	if mainErr == nil && mainExists {
		return mainValue, true, nil
	}

	backupValue, backupExists, backupErr := readJSONFile[T](targetPath + ".bak")
	if backupErr == nil && backupExists {
		return backupValue, true, nil
	}
	if !mainExists && !backupExists && mainErr == nil && backupErr == nil {
		return value, false, nil
	}

	return value, false, fmt.Errorf("main file error: %v; backup file error: %v", mainErr, backupErr)
}

// readJSONFile 使用严格 JSON 解码读取单个文件
// 未知字段会被拒绝 避免拼写错误或未来不兼容字段静默进入领域对象
func readJSONFile[T any](filePath string) (value T, exists bool, returnErr error) {
	file, err := os.Open(filePath)
	if errors.Is(err, os.ErrNotExist) {
		return value, false, nil
	}
	if err != nil {
		return value, false, fmt.Errorf("open file: %w", err)
	}
	defer func() {
		closeErr := file.Close()
		if closeErr != nil && returnErr == nil {
			returnErr = fmt.Errorf("close file: %w", closeErr)
		}
	}()

	decoder := json.NewDecoder(file)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&value); err != nil {
		return value, true, fmt.Errorf("decode JSON: %w", err)
	}
	if err := ensureJSONEOF(decoder); err != nil {
		return value, true, err
	}

	return value, true, nil
}

// ensureJSONEOF 确认一个 JSON 文件只包含单个顶层值
// 防止合法 JSON 后面拼接第二段数据却被 decoder 静默忽略
func ensureJSONEOF(decoder *json.Decoder) error {
	var trailingValue any
	err := decoder.Decode(&trailingValue)
	if errors.Is(err, io.EOF) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("decode trailing JSON: %w", err)
	}

	return fmt.Errorf("file contains multiple JSON values")
}

// removeStaleThreadFiles 清理已经不在 workspace index 中的主 thread JSON
// .bak 文件保留用于人工恢复 临时文件会在 atomic writer defer 中自行清理
func removeStaleThreadFiles(threadsDir string, desiredFiles map[string]struct{}) error {
	entries, err := os.ReadDir(threadsDir)
	if err != nil {
		return fmt.Errorf("read threads directory: %w", err)
	}

	for _, entry := range entries {
		if entry.IsDir() || filepath.Ext(entry.Name()) != ".json" {
			continue
		}
		if _, desired := desiredFiles[entry.Name()]; desired {
			continue
		}
		if err := os.Remove(filepath.Join(threadsDir, entry.Name())); err != nil {
			return fmt.Errorf("remove %q: %w", entry.Name(), err)
		}
	}

	return nil
}
