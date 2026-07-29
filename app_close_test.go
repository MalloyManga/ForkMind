package main

import (
	"context"
	"testing"
)

// TestAppCloseCoordinatorLifecycle 验证未确认关闭始终被拦截且可以重复通知
// 前端确认后下一次 Wails 关闭回调必须被允许通过
func TestAppCloseCoordinatorLifecycle(t *testing.T) {
	t.Parallel()

	coordinator := NewAppCloseCoordinator()
	preventClose, shouldNotify := coordinator.BeginClose()
	if !preventClose || !shouldNotify {
		t.Fatalf("first BeginClose() = (%v, %v), want (true, true)", preventClose, shouldNotify)
	}

	preventClose, shouldNotify = coordinator.BeginClose()
	if !preventClose || !shouldNotify {
		t.Fatalf("pending BeginClose() = (%v, %v), want (true, true)", preventClose, shouldNotify)
	}

	coordinator.ConfirmClose()
	preventClose, shouldNotify = coordinator.BeginClose()
	if preventClose || shouldNotify {
		t.Fatalf("confirmed BeginClose() = (%v, %v), want (false, false)", preventClose, shouldNotify)
	}
}

// TestAppCloseCoordinatorAbortAllowsRetry 验证保存失败后再次关闭会重新通知前端
func TestAppCloseCoordinatorAbortAllowsRetry(t *testing.T) {
	t.Parallel()

	coordinator := NewAppCloseCoordinator()
	coordinator.BeginClose()
	coordinator.AbortClose()

	preventClose, shouldNotify := coordinator.BeginClose()
	if !preventClose || !shouldNotify {
		t.Fatalf("retry BeginClose() = (%v, %v), want (true, true)", preventClose, shouldNotify)
	}
}

// TestBeforeCloseEmitsRetryableEvent 验证 Wails 关闭拦截会通知 React 且重复请求可重发
func TestBeforeCloseEmitsRetryableEvent(t *testing.T) {
	previousEmitter := emitWailsEvent
	defer func() { emitWailsEvent = previousEmitter }()

	eventCount := 0
	var eventName string
	emitWailsEvent = func(_ context.Context, name string, _ ...interface{}) {
		eventCount++
		eventName = name
	}

	app := &App{closeCoordinator: NewAppCloseCoordinator()}
	if !app.beforeClose(context.Background()) {
		t.Fatal("first beforeClose() = false, want true")
	}
	if !app.beforeClose(context.Background()) {
		t.Fatal("pending beforeClose() = false, want true")
	}
	if eventCount != 2 || eventName != appBeforeCloseEvent {
		t.Fatalf("events = (%d, %q), want (2, %q)", eventCount, eventName, appBeforeCloseEvent)
	}

	app.closeCoordinator.ConfirmClose()
	if app.beforeClose(context.Background()) {
		t.Fatal("confirmed beforeClose() = true, want false")
	}
	if eventCount != 2 {
		t.Fatalf("confirmed close emitted event count = %d, want 2", eventCount)
	}
}

// TestBeforeCloseWithoutCoordinatorAllowsClose 验证初始化异常时不会永久拦截窗口关闭
func TestBeforeCloseWithoutCoordinatorAllowsClose(t *testing.T) {
	if (&App{}).beforeClose(context.Background()) {
		t.Fatal("beforeClose() without coordinator = true, want false")
	}
}

// TestAppCloseBridgeScenarios 验证 Complete 和 Abort Bridge 的 context 与协调器错误分支
func TestAppCloseBridgeScenarios(t *testing.T) {
	previousQuit := quitWailsApplication
	defer func() { quitWailsApplication = previousQuit }()

	if response := (&App{}).CompleteAppClose(); response.Error == nil || response.Error.Code != errorCodeInternal {
		t.Fatalf("CompleteAppClose() without context = %#v", response)
	}
	if response := (&App{ctx: context.Background()}).CompleteAppClose(); response.Error == nil || response.Error.Code != errorCodeInternal {
		t.Fatalf("CompleteAppClose() without coordinator = %#v", response)
	}
	if response := (&App{}).AbortAppClose(); response.Error == nil || response.Error.Code != errorCodeInternal {
		t.Fatalf("AbortAppClose() without coordinator = %#v", response)
	}

	quitCalled := false
	quitWailsApplication = func(context.Context) { quitCalled = true }
	coordinator := NewAppCloseCoordinator()
	app := &App{ctx: context.Background(), closeCoordinator: coordinator}
	if response := app.CompleteAppClose(); response.Error != nil {
		t.Fatalf("successful CompleteAppClose() = %#v", response)
	}
	if !quitCalled {
		t.Fatal("CompleteAppClose() did not call quit port")
	}
	preventClose, _ := coordinator.BeginClose()
	if preventClose {
		t.Fatal("confirmed coordinator still prevents close")
	}

	if response := app.AbortAppClose(); response.Error != nil {
		t.Fatalf("successful AbortAppClose() = %#v", response)
	}
	if response := (&App{closeCoordinator: coordinator}).AbortAppClose(); response.Error != nil {
		t.Fatalf("retry AbortAppClose() = %#v", response)
	}
}
