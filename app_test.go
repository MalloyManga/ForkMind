package main

import (
	"context"
	"errors"
	"path/filepath"
	"testing"

	"github.com/wailsapp/wails/v2/pkg/options"
)

// TestNewAppInitializesRuntimeServices 验证应用构造器提供所有运行时服务
// 该测试不启动窗口 只检查 Wails 主进程依赖是否完整
func TestNewAppInitializesRuntimeServices(t *testing.T) {
	t.Parallel()

	app := NewApp()
	if app.openAIClient == nil {
		t.Fatal("NewApp().openAIClient = nil")
	}
	if app.aiRequestManager == nil {
		t.Fatal("NewApp().aiRequestManager = nil")
	}
	if app.closeCoordinator == nil {
		t.Fatal("NewApp().closeCoordinator = nil")
	}
	if app.workspaceRepository == nil && app.initializationError == nil {
		t.Fatal("NewApp() returned neither repository nor initialization error")
	}
}

// TestAppStartupStoresWailsContext 验证 Wails startup 生命周期把 context 保存到 App
// 后续事件 对话框和退出命令都依赖同一个 context
func TestAppStartupStoresWailsContext(t *testing.T) {
	t.Parallel()

	app := &App{}
	ctx := context.WithValue(context.Background(), appContextTestKey{}, "startup")
	app.startup(ctx)
	if app.ctx != ctx {
		t.Fatal("startup() did not retain the Wails context")
	}
}

// TestCreateApplicationOptions 验证桌面壳层尺寸 生命周期回调和 Bridge 绑定
// 返回配置只供 wails.Run 消费 测试不会创建真实窗口
func TestCreateApplicationOptions(t *testing.T) {
	t.Parallel()

	app := &App{}
	applicationOptions := createApplicationOptions(app)
	if applicationOptions.Title != "ForkMind" {
		t.Fatalf("Title = %q, want ForkMind", applicationOptions.Title)
	}
	if applicationOptions.Width != 1024 || applicationOptions.Height != 768 {
		t.Fatalf("window size = %dx%d, want 1024x768", applicationOptions.Width, applicationOptions.Height)
	}
	if applicationOptions.OnStartup == nil || applicationOptions.OnBeforeClose == nil {
		t.Fatal("lifecycle callbacks must be configured")
	}
	if len(applicationOptions.Bind) != 1 || applicationOptions.Bind[0] != app {
		t.Fatalf("Bind = %#v, want the App instance", applicationOptions.Bind)
	}
	if applicationOptions.AssetServer == nil || applicationOptions.AssetServer.Assets == nil {
		t.Fatal("embedded frontend assets must be configured")
	}
}

// TestMainDelegatesToWailsRunner 验证进程入口把完整配置交给 Wails
// runner 被替换为内存函数 因此同时覆盖成功和启动失败分支而不打开窗口
func TestMainDelegatesToWailsRunner(t *testing.T) {
	previousRunner := runWailsApplication
	previousResolver := resolveUserConfigDirectory
	defer func() {
		runWailsApplication = previousRunner
		resolveUserConfigDirectory = previousResolver
	}()

	resolveUserConfigDirectory = func() (string, error) {
		return filepath.Join(t.TempDir(), "config"), nil
	}

	for _, runnerError := range []error{nil, errors.New("startup failed")} {
		called := false
		runWailsApplication = func(applicationOptions *options.App) error {
			called = true
			if applicationOptions.Title != "ForkMind" {
				t.Errorf("runner Title = %q, want ForkMind", applicationOptions.Title)
			}
			return runnerError
		}

		main()
		if !called {
			t.Fatal("main() did not call the Wails runner")
		}
	}
}

type appContextTestKey struct{}
