package main

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// TestURLContentFetcherPreservesCancellation 验证取消信号经过抓取和卡片包装后仍可由 Bridge 识别
func TestURLContentFetcherPreservesCancellation(t *testing.T) {
	t.Parallel()

	server := httptest.NewServer(http.HandlerFunc(func(responseWriter http.ResponseWriter, _ *http.Request) {
		responseWriter.Header().Set("Content-Type", "text/html")
		_, _ = responseWriter.Write([]byte("<html><body>unused</body></html>"))
	}))
	defer server.Close()

	requestContext, cancel := context.WithCancel(context.Background())
	cancel()
	_, err := newURLContentFetcherForTest(server.Client()).Fetch(requestContext, server.URL)
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("Fetch() error = %v want context.Canceled", err)
	}
}

// TestURLContentFetcherExtractsReadableHTML 验证抓取器跟随受控重定向并剔除脚本与样式
func TestURLContentFetcherExtractsReadableHTML(t *testing.T) {
	t.Parallel()

	server := httptest.NewServer(http.HandlerFunc(func(responseWriter http.ResponseWriter, request *http.Request) {
		if request.URL.Path == "/start" {
			http.Redirect(responseWriter, request, "/article", http.StatusFound)
			return
		}
		if request.Header.Get("User-Agent") != urlFetchUserAgent {
			t.Errorf("User-Agent = %q", request.Header.Get("User-Agent"))
		}
		responseWriter.Header().Set("Content-Type", "text/html; charset=utf-8")
		_, _ = responseWriter.Write([]byte(`<!doctype html><html><head><title> Test Article </title><style>.hidden{}</style></head><body><main><h1>Hello</h1><p>Readable world</p><script>ignore()</script></main></body></html>`))
	}))
	defer server.Close()

	result, err := newURLContentFetcherForTest(server.Client()).Fetch(context.Background(), server.URL+"/start#section")
	if err != nil {
		t.Fatalf("Fetch() error = %v", err)
	}
	if result.FinalURL != server.URL+"/article" {
		t.Fatalf("FinalURL = %q", result.FinalURL)
	}
	if result.Title != "Test Article" {
		t.Fatalf("Title = %q", result.Title)
	}
	if result.Text != "Hello Readable world" {
		t.Fatalf("Text = %q", result.Text)
	}
}

// TestURLContentFetcherRejectsUnsafeAndInvalidInputs 验证协议 凭据和私网地址在 HTTP 前被拒绝
func TestURLContentFetcherRejectsUnsafeAndInvalidInputs(t *testing.T) {
	t.Parallel()

	fetcher := NewURLContentFetcher()
	for _, testCase := range []struct {
		name          string
		requestURL    string
		errorFragment string
	}{
		{name: "file scheme", requestURL: "file:///etc/passwd", errorFragment: "http or https"},
		{name: "credentials", requestURL: "https://user:pass@example.com", errorFragment: "credentials"},
		{name: "loopback", requestURL: "http://127.0.0.1/private", errorFragment: "non-public"},
		{name: "private IPv4", requestURL: "http://192.168.1.2/private", errorFragment: "non-public"},
		{name: "carrier grade NAT", requestURL: "http://100.64.0.1/private", errorFragment: "non-public"},
		{name: "link local", requestURL: "http://169.254.169.254/latest/meta-data", errorFragment: "non-public"},
		{name: "IPv6 loopback", requestURL: "http://[::1]/private", errorFragment: "non-public"},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			_, err := fetcher.Fetch(context.Background(), testCase.requestURL)
			if err == nil || !strings.Contains(err.Error(), testCase.errorFragment) {
				t.Fatalf("Fetch() error = %v want fragment %q", err, testCase.errorFragment)
			}
		})
	}
}

// TestURLContentFetcherResponseBoundaries 验证重定向次数 MIME 和响应体大小限制
func TestURLContentFetcherResponseBoundaries(t *testing.T) {
	t.Parallel()

	server := httptest.NewServer(http.HandlerFunc(func(responseWriter http.ResponseWriter, request *http.Request) {
		switch request.URL.Path {
		case "/redirect":
			http.Redirect(responseWriter, request, "/redirect", http.StatusTemporaryRedirect)
		case "/json":
			responseWriter.Header().Set("Content-Type", "application/json")
			_, _ = responseWriter.Write([]byte(`{"value":true}`))
		case "/large":
			responseWriter.Header().Set("Content-Type", "text/html")
			responseWriter.Header().Set("Content-Length", fmt.Sprint(defaultURLFetchMaxBodyBytes+1))
			_, _ = responseWriter.Write([]byte("too large"))
		default:
			http.NotFound(responseWriter, request)
		}
	}))
	defer server.Close()

	fetcher := newURLContentFetcherForTest(server.Client())
	for _, testCase := range []struct {
		path          string
		errorFragment string
	}{
		{path: "/redirect", errorFragment: "redirects exceed"},
		{path: "/json", errorFragment: "not supported"},
		{path: "/large", errorFragment: "exceeds"},
	} {
		_, err := fetcher.Fetch(context.Background(), server.URL+testCase.path)
		if err == nil || !strings.Contains(err.Error(), testCase.errorFragment) {
			t.Fatalf("Fetch(%q) error = %v want fragment %q", testCase.path, err, testCase.errorFragment)
		}
	}
}

// TestHydrateReferencedLinkContentScopesCards 验证只读取父链与当前节点直接引用的 Link Card
func TestHydrateReferencedLinkContentScopesCards(t *testing.T) {
	t.Parallel()

	requestedPaths := make([]string, 0, 2)
	server := httptest.NewServer(http.HandlerFunc(func(responseWriter http.ResponseWriter, request *http.Request) {
		requestedPaths = append(requestedPaths, request.URL.Path)
		responseWriter.Header().Set("Content-Type", "text/html")
		_, _ = responseWriter.Write([]byte("<html><head><title>" + request.URL.Path + "</title></head><body>content " + request.URL.Path + "</body></html>"))
	}))
	defer server.Close()

	rootID := "root"
	parentLinkID := "parent-link"
	thread := ConversationThreadDTO{Cards: []ConversationCardDTO{
		{ID: rootID, CardType: "chat", UserPrompt: "root"},
		{ID: parentLinkID, CardType: "link", ParentID: &rootID, URL: server.URL + "/parent", Description: "manual parent note"},
		{ID: "active", CardType: "chat", ParentID: &parentLinkID, ReferenceNodeIDs: []string{"reference-link"}, UserPrompt: "question"},
		{ID: "reference-link", CardType: "link", URL: server.URL + "/reference"},
		{ID: "unrelated-link", CardType: "link", URL: server.URL + "/unrelated"},
	}}

	hydrated, err := hydrateReferencedLinkContent(
		context.Background(),
		thread,
		"active",
		newURLContentFetcherForTest(server.Client()),
	)
	if err != nil {
		t.Fatalf("hydrateReferencedLinkContent() error = %v", err)
	}
	if strings.Join(requestedPaths, ",") != "/parent,/reference" {
		t.Fatalf("requested paths = %v", requestedPaths)
	}
	if !strings.Contains(hydrated.Cards[1].Description, "manual parent note") || !strings.Contains(hydrated.Cards[1].Description, "content /parent") {
		t.Fatalf("parent description = %q", hydrated.Cards[1].Description)
	}
	if !strings.Contains(hydrated.Cards[3].Description, "不可信来源") || !strings.Contains(hydrated.Cards[3].Description, "content /reference") {
		t.Fatalf("reference description = %q", hydrated.Cards[3].Description)
	}
	if hydrated.Cards[4].Description != "" {
		t.Fatalf("unrelated description = %q", hydrated.Cards[4].Description)
	}
	if thread.Cards[1].Description != "manual parent note" || thread.Cards[3].Description != "" {
		t.Fatal("hydrateReferencedLinkContent() mutated the Zustand thread snapshot")
	}
}

// TestHydrateReferencedLinkContentLimitsReferences 验证单轮网页数量上限在发起网络请求前生效
func TestHydrateReferencedLinkContentLimitsReferences(t *testing.T) {
	t.Parallel()

	thread := ConversationThreadDTO{Cards: []ConversationCardDTO{{
		ID:               "active",
		CardType:         "chat",
		UserPrompt:       "question",
		ReferenceNodeIDs: []string{"link-0", "link-1", "link-2", "link-3", "link-4"},
	}}}
	for referenceIndex := 0; referenceIndex < 5; referenceIndex++ {
		thread.Cards = append(thread.Cards, ConversationCardDTO{
			ID:       fmt.Sprintf("link-%d", referenceIndex),
			CardType: "link",
			URL:      "https://example.com",
		})
	}

	_, err := hydrateReferencedLinkContent(context.Background(), thread, "active", NewURLContentFetcher())
	if err == nil || !strings.Contains(err.Error(), "exceed") {
		t.Fatalf("hydrateReferencedLinkContent() error = %v", err)
	}
}
