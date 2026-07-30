package main

import (
	"encoding/json"
	"errors"
	"math"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// TestNewDefaultWorkspaceRepository 验证软件目录 data 映射和可执行文件路径失败分支
func TestNewDefaultWorkspaceRepository(t *testing.T) {
	previousResolver := resolveExecutablePath
	previousWorkingDirectoryResolver := resolveWorkingDirectory
	defer func() {
		resolveExecutablePath = previousResolver
		resolveWorkingDirectory = previousWorkingDirectoryResolver
	}()

	applicationDirectory := filepath.Join(t.TempDir(), "ForkMind")
	projectDirectory := filepath.Join(t.TempDir(), "project")
	resolveExecutablePath = func() (string, error) {
		return filepath.Join(applicationDirectory, "ForkMind.exe"), nil
	}
	resolveWorkingDirectory = func() (string, error) { return projectDirectory, nil }
	repository, err := NewDefaultWorkspaceRepository()
	if err != nil {
		t.Fatalf("NewDefaultWorkspaceRepository() error = %v", err)
	}
	expectedRoot := filepath.Join(applicationDirectory, workspaceDataDirectoryName)
	if isDevelopmentBuild {
		expectedRoot = filepath.Join(projectDirectory, developmentDataDirectoryName)
	}
	if repository.RootDir() != expectedRoot {
		t.Fatalf("RootDir() = %q", repository.RootDir())
	}

	resolveExecutablePath = func() (string, error) { return "", errors.New("no executable") }
	if _, err := NewDefaultWorkspaceRepository(); err == nil || !strings.Contains(err.Error(), "resolve executable path") {
		t.Fatalf("NewDefaultWorkspaceRepository() error = %v", err)
	}

	resolveExecutablePath = func() (string, error) { return "", nil }
	if _, err := NewDefaultWorkspaceRepository(); err == nil || !strings.Contains(err.Error(), "path is empty") {
		t.Fatalf("NewDefaultWorkspaceRepository() empty path error = %v", err)
	}

	if isDevelopmentBuild {
		resolveExecutablePath = func() (string, error) {
			return filepath.Join(applicationDirectory, "ForkMind.exe"), nil
		}
		resolveWorkingDirectory = func() (string, error) { return "", errors.New("no working directory") }
		if _, err := NewDefaultWorkspaceRepository(); err == nil || !strings.Contains(err.Error(), "resolve development working directory") {
			t.Fatalf("NewDefaultWorkspaceRepository() working directory error = %v", err)
		}
	}
}

// TestResolveDefaultWorkspaceRoot 验证开发数据不进入 build/bin 且生产数据跟随可执行文件
func TestResolveDefaultWorkspaceRoot(t *testing.T) {
	t.Parallel()

	applicationDirectory := filepath.Join(t.TempDir(), "application")
	executablePath := filepath.Join(applicationDirectory, "ForkMind.exe")
	projectDirectory := filepath.Join(t.TempDir(), "project")

	testCases := []struct {
		name             string
		executablePath   string
		workingDirectory string
		development      bool
		want             string
		wantError        string
	}{
		{
			name:           "release beside executable",
			executablePath: executablePath,
			want:           filepath.Join(applicationDirectory, workspaceDataDirectoryName),
		},
		{
			name:             "development inside project",
			executablePath:   executablePath,
			workingDirectory: projectDirectory,
			development:      true,
			want:             filepath.Join(projectDirectory, developmentDataDirectoryName),
		},
		{name: "empty executable", wantError: "executable path is empty"},
		{
			name:           "empty development working directory",
			executablePath: executablePath,
			development:    true,
			wantError:      "development working directory is empty",
		},
	}

	for _, testCase := range testCases {
		t.Run(testCase.name, func(t *testing.T) {
			actual, err := resolveDefaultWorkspaceRoot(
				testCase.executablePath,
				testCase.workingDirectory,
				testCase.development,
			)
			if testCase.wantError != "" {
				if err == nil || !strings.Contains(err.Error(), testCase.wantError) {
					t.Fatalf("resolveDefaultWorkspaceRoot() error = %v", err)
				}
				return
			}
			if err != nil || actual != testCase.want {
				t.Fatalf("resolveDefaultWorkspaceRoot() = (%q, %v), want %q", actual, err, testCase.want)
			}
		})
	}
}

// TestWorkspaceRepositoryPathResolution 验证索引路径只能留在 ForkMind 数据目录内
func TestWorkspaceRepositoryPathResolution(t *testing.T) {
	t.Parallel()

	repository := NewWorkspaceRepository(filepath.Join(t.TempDir(), "root", "..", "root"))
	validPath, err := repository.resolveIndexedThreadPath("threads/thread.json")
	if err != nil || !strings.HasSuffix(validPath, filepath.Join("threads", "thread.json")) {
		t.Fatalf("valid path = %q, error = %v", validPath, err)
	}

	for _, indexedPath := range []string{"", "../outside.json", filepath.Join(filepath.VolumeName(repository.RootDir())+string(os.PathSeparator), "outside.json")} {
		if _, err := repository.resolveIndexedThreadPath(indexedPath); err == nil {
			t.Fatalf("resolveIndexedThreadPath(%q) error = nil", indexedPath)
		}
	}
}

// TestWorkspaceRepositoryLoadHeaderFailures 验证 index 和 thread 文件头及 id 一致性
func TestWorkspaceRepositoryLoadHeaderFailures(t *testing.T) {
	t.Parallel()

	testCases := []struct {
		name          string
		mutateIndex   func(index *workspaceIndexDocument)
		mutateThread  func(thread *threadFileDocument)
		skipThread    bool
		errorFragment string
	}{
		{name: "index format", mutateIndex: func(index *workspaceIndexDocument) { index.Format = "bad" }, errorFragment: "index format"},
		{name: "index version", mutateIndex: func(index *workspaceIndexDocument) { index.Version = "2" }, errorFragment: "index version"},
		{name: "missing thread", skipThread: true, errorFragment: "file is missing"},
		{name: "thread format", mutateThread: func(thread *threadFileDocument) { thread.Format = "bad" }, errorFragment: "header is invalid"},
		{name: "thread version", mutateThread: func(thread *threadFileDocument) { thread.Version = "2" }, errorFragment: "header is invalid"},
		{name: "thread id", mutateThread: func(thread *threadFileDocument) { thread.Thread.ID = "other" }, errorFragment: "does not match"},
	}

	for _, testCase := range testCases {
		t.Run(testCase.name, func(t *testing.T) {
			repository := NewWorkspaceRepository(t.TempDir())
			indexDocument, threadDocument := createRepositoryDocuments()
			if testCase.mutateIndex != nil {
				testCase.mutateIndex(&indexDocument)
			}
			if testCase.mutateThread != nil {
				testCase.mutateThread(&threadDocument)
			}
			writeRepositoryFixture(t, repository, indexDocument, threadDocument, testCase.skipThread)

			_, _, err := repository.LoadWorkspace()
			if err == nil || !strings.Contains(err.Error(), testCase.errorFragment) {
				t.Fatalf("LoadWorkspace() error = %v, want %q", err, testCase.errorFragment)
			}
		})
	}
}

// TestStrictJSONReaders 验证未知字段 多顶层值 主备份损坏和不存在语义
func TestStrictJSONReaders(t *testing.T) {
	t.Parallel()

	type fixture struct {
		Name string `json:"name"`
	}
	rootDir := t.TempDir()

	missingValue, exists, err := readJSONFile[fixture](filepath.Join(rootDir, "missing.json"))
	if err != nil || exists || missingValue.Name != "" {
		t.Fatalf("missing read = (%#v, %v, %v)", missingValue, exists, err)
	}

	unknownPath := filepath.Join(rootDir, "unknown.json")
	writeTestBytes(t, unknownPath, []byte(`{"name":"ok","extra":true}`))
	if _, _, err := readJSONFile[fixture](unknownPath); err == nil || !strings.Contains(err.Error(), "unknown field") {
		t.Fatalf("unknown field error = %v", err)
	}

	trailingPath := filepath.Join(rootDir, "trailing.json")
	writeTestBytes(t, trailingPath, []byte(`{"name":"one"} {"name":"two"}`))
	if _, _, err := readJSONFile[fixture](trailingPath); err == nil || !strings.Contains(err.Error(), "multiple JSON values") {
		t.Fatalf("trailing value error = %v", err)
	}

	brokenPath := filepath.Join(rootDir, "broken.json")
	writeTestBytes(t, brokenPath, []byte(`{broken`))
	writeTestBytes(t, brokenPath+".bak", []byte(`{also-broken`))
	if _, _, err := readJSONWithBackup[fixture](brokenPath); err == nil || !strings.Contains(err.Error(), "main file error") {
		t.Fatalf("readJSONWithBackup() error = %v", err)
	}
}

// TestEnsureJSONEOF 验证严格解码器接受空白 EOF 并拒绝损坏尾部与第二个值
func TestEnsureJSONEOF(t *testing.T) {
	t.Parallel()

	for _, testCase := range []struct {
		name    string
		content string
		wantErr bool
	}{
		{name: "eof", content: "", wantErr: false},
		{name: "malformed", content: "{", wantErr: true},
		{name: "second value", content: `{"value":1}`, wantErr: true},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			err := ensureJSONEOF(json.NewDecoder(strings.NewReader(testCase.content)))
			if (err != nil) != testCase.wantErr {
				t.Fatalf("ensureJSONEOF() error = %v", err)
			}
		})
	}
}

// TestWriteJSONAtomicallyErrorsAndBackup 验证编码错误 目录错误和上一版备份
func TestWriteJSONAtomicallyErrorsAndBackup(t *testing.T) {
	t.Parallel()

	if err := writeJSONAtomically(filepath.Join(t.TempDir(), "nan.json"), math.NaN()); err == nil || !strings.Contains(err.Error(), "encode JSON") {
		t.Fatalf("NaN write error = %v", err)
	}

	blockingFile := filepath.Join(t.TempDir(), "blocking")
	writeTestBytes(t, blockingFile, []byte("file"))
	if err := writeJSONAtomically(filepath.Join(blockingFile, "target.json"), map[string]string{"ok": "yes"}); err == nil || !strings.Contains(err.Error(), "create target directory") {
		t.Fatalf("blocked directory error = %v", err)
	}

	targetPath := filepath.Join(t.TempDir(), "value.json")
	if err := writeJSONAtomically(targetPath, map[string]int{"version": 1}); err != nil {
		t.Fatalf("first atomic write: %v", err)
	}
	if err := writeJSONAtomically(targetPath, map[string]int{"version": 2}); err != nil {
		t.Fatalf("second atomic write: %v", err)
	}
	backupContent, err := os.ReadFile(targetPath + ".bak")
	if err != nil || !strings.Contains(string(backupContent), `"version": 1`) {
		t.Fatalf("backup content = %q, error = %v", backupContent, err)
	}
}

// TestRemoveStaleThreadFilesBoundaries 验证只删除非期望主 JSON 并忽略目录和备份
func TestRemoveStaleThreadFilesBoundaries(t *testing.T) {
	t.Parallel()

	if err := removeStaleThreadFiles(filepath.Join(t.TempDir(), "missing"), nil); err == nil {
		t.Fatal("removeStaleThreadFiles(missing) error = nil")
	}

	threadsDir := t.TempDir()
	desiredName := "desired.json"
	staleName := "stale.json"
	writeTestBytes(t, filepath.Join(threadsDir, desiredName), []byte("{}"))
	writeTestBytes(t, filepath.Join(threadsDir, staleName), []byte("{}"))
	writeTestBytes(t, filepath.Join(threadsDir, "stale.json.bak"), []byte("{}"))
	if err := os.Mkdir(filepath.Join(threadsDir, "nested.json"), 0o755); err != nil {
		t.Fatalf("create nested directory: %v", err)
	}
	if err := removeStaleThreadFiles(threadsDir, map[string]struct{}{desiredName: {}}); err != nil {
		t.Fatalf("removeStaleThreadFiles() error = %v", err)
	}
	if _, err := os.Stat(filepath.Join(threadsDir, staleName)); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("stale file stat error = %v", err)
	}
	for _, preservedName := range []string{desiredName, "stale.json.bak", "nested.json"} {
		if _, err := os.Stat(filepath.Join(threadsDir, preservedName)); err != nil {
			t.Fatalf("preserved %q stat error = %v", preservedName, err)
		}
	}
}

// createRepositoryDocuments 构造 index 与 thread 文件测试夹具
func createRepositoryDocuments() (workspaceIndexDocument, threadFileDocument) {
	document := createTestWorkspaceDocument()
	thread := document.Threads[0]
	threadFileName := buildThreadFileName(thread.ID)
	return workspaceIndexDocument{
			Format:         workspaceFormat,
			Version:        workspaceVersion,
			ActiveThreadID: thread.ID,
			Threads: []workspaceThreadIndexEntry{{
				ID:        thread.ID,
				Title:     thread.Title,
				File:      filepath.ToSlash(filepath.Join(threadsDirectoryName, threadFileName)),
				CreatedAt: thread.CreatedAt,
				UpdatedAt: thread.UpdatedAt,
			}},
			Settings:     document.Settings,
			LastModified: document.LastModified,
		}, threadFileDocument{
			Format:  threadFileFormat,
			Version: workspaceVersion,
			Thread:  thread,
		}
}

// writeRepositoryFixture 写入 LoadWorkspace 测试使用的 index 和可选 thread 文件
func writeRepositoryFixture(
	t *testing.T,
	repository *WorkspaceRepository,
	indexDocument workspaceIndexDocument,
	threadDocument threadFileDocument,
	skipThread bool,
) {
	t.Helper()
	if err := writeJSONAtomically(filepath.Join(repository.RootDir(), workspaceIndexFileName), indexDocument); err != nil {
		t.Fatalf("write index fixture: %v", err)
	}
	if skipThread {
		return
	}
	threadPath, err := repository.resolveIndexedThreadPath(indexDocument.Threads[0].File)
	if err != nil {
		t.Fatalf("resolve thread fixture path: %v", err)
	}
	if err := writeJSONAtomically(threadPath, threadDocument); err != nil {
		t.Fatalf("write thread fixture: %v", err)
	}
}

// writeTestBytes 创建测试文件并严格处理写入错误
func writeTestBytes(t *testing.T, filePath string, content []byte) {
	t.Helper()
	if err := os.WriteFile(filePath, content, 0o600); err != nil {
		t.Fatalf("write %q: %v", filePath, err)
	}
}
