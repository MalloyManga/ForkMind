package main

import (
	"context"
)

// App struct
type App struct {
	ctx                 context.Context
	workspaceRepository *WorkspaceRepository
	initializationError error
	openAIClient        *OpenAIClient
	aiRequestManager    *AIRequestManager
	closeCoordinator    *AppCloseCoordinator
}

// NewApp creates a new App application struct
func NewApp() *App {
	workspaceRepository, err := NewDefaultWorkspaceRepository()
	return &App{
		workspaceRepository: workspaceRepository,
		initializationError: err,
		openAIClient:        NewOpenAIClient(),
		aiRequestManager:    NewAIRequestManager(),
		closeCoordinator:    NewAppCloseCoordinator(),
	}
}

// startup is called when the app starts. The context is saved
// so we can call the runtime methods
func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
}
