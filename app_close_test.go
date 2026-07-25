package main

import "testing"

// TestAppCloseCoordinatorLifecycle 验证首次关闭被拦截且只通知一次
// 前端确认后下一次 Wails 关闭回调必须被允许通过
func TestAppCloseCoordinatorLifecycle(t *testing.T) {
	t.Parallel()

	coordinator := NewAppCloseCoordinator()
	preventClose, shouldNotify := coordinator.BeginClose()
	if !preventClose || !shouldNotify {
		t.Fatalf("first BeginClose() = (%v, %v), want (true, true)", preventClose, shouldNotify)
	}

	preventClose, shouldNotify = coordinator.BeginClose()
	if !preventClose || shouldNotify {
		t.Fatalf("pending BeginClose() = (%v, %v), want (true, false)", preventClose, shouldNotify)
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
