package main

import (
	"context"
	"fmt"
)

// App struct
type App struct {
	ctx                 context.Context
	workspaceRepository *WorkspaceRepository
	initializationError error
	openAIClient        *OpenAIClient
	aiRequestManager    *AIRequestManager
}

// NewApp creates a new App application struct
func NewApp() *App {
	workspaceRepository, err := NewDefaultWorkspaceRepository()
	return &App{
		workspaceRepository: workspaceRepository,
		initializationError: err,
		openAIClient:        NewOpenAIClient(),
		aiRequestManager:    NewAIRequestManager(),
	}
}

// startup is called when the app starts. The context is saved
// so we can call the runtime methods
func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
}

// Greet returns a greeting for the given name
func (a *App) Greet(name string) string {
	return fmt.Sprintf("Hello %s, It's show time!", name)
}
