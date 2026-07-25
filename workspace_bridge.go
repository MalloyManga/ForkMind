package main

import "fmt"

// LoadWorkspace 从 ForkMind 用户数据目录恢复完整工作区
// 前端应用挂载时触发 Exists=false 表示首次启动应该继续使用内置空工作区
func (a *App) LoadWorkspace() WorkspaceLoadResponse {
	if a.initializationError != nil {
		return WorkspaceLoadResponse{
			Error: newBridgeError(
				errorCodeInternal,
				fmt.Errorf("initialize workspace repository: %w", a.initializationError),
				false,
			),
		}
	}
	if a.workspaceRepository == nil {
		return WorkspaceLoadResponse{
			Error: newBridgeError(errorCodeInternal, fmt.Errorf("workspace repository is unavailable"), false),
		}
	}

	document, exists, err := a.workspaceRepository.LoadWorkspace()
	if err != nil {
		return WorkspaceLoadResponse{
			Error: newBridgeError(errorCodeReadFailed, err, true),
		}
	}
	if !exists {
		return WorkspaceLoadResponse{Exists: false}
	}

	return WorkspaceLoadResponse{
		Exists:    true,
		Workspace: &document,
	}
}

// SaveWorkspace 把 React workspaceStore 的完整快照保存到本地
// document 不包含 API Key Repository 会先校验再拆分为 index 与 thread 文件
func (a *App) SaveWorkspace(document WorkspaceDocumentDTO) OperationResponse {
	if a.initializationError != nil {
		return OperationResponse{
			Error: newBridgeError(
				errorCodeInternal,
				fmt.Errorf("initialize workspace repository: %w", a.initializationError),
				false,
			),
		}
	}
	if a.workspaceRepository == nil {
		return OperationResponse{
			Error: newBridgeError(errorCodeInternal, fmt.Errorf("workspace repository is unavailable"), false),
		}
	}

	if err := a.workspaceRepository.SaveWorkspace(document); err != nil {
		return OperationResponse{
			Error: newBridgeError(errorCodeWriteFailed, err, true),
		}
	}

	return OperationResponse{}
}

// GetDataDirectory 返回 ForkMind 本地数据目录
// 设置页面或错误排查时触发 Path 为空且 Error 非 nil 表示目录初始化失败
func (a *App) GetDataDirectory() DataDirectoryResponse {
	if a.initializationError != nil {
		return DataDirectoryResponse{
			Error: newBridgeError(
				errorCodeInternal,
				fmt.Errorf("initialize workspace repository: %w", a.initializationError),
				false,
			),
		}
	}
	if a.workspaceRepository == nil {
		return DataDirectoryResponse{
			Error: newBridgeError(errorCodeInternal, fmt.Errorf("workspace repository is unavailable"), false),
		}
	}

	return DataDirectoryResponse{Path: a.workspaceRepository.RootDir()}
}
