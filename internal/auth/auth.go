package auth

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"sync"

	"github.com/kappaseijin/scale2sheet4go/internal/config"
	"golang.org/x/oauth2"
	"golang.org/x/oauth2/google"
)

type SheetsAuthDescriptor struct {
	CredentialsPath string
	SpreadsheetID   string
	SheetName       string
}

func CreateGoogleSheetsAuth(settings config.GoogleSheetsAuthConfig) SheetsAuthDescriptor {
	return SheetsAuthDescriptor{
		CredentialsPath: settings.ApplicationCredentialsPath,
		SpreadsheetID:   settings.SpreadsheetID,
		SheetName:       settings.SheetName,
	}
}

type GoogleFitOAuthClient struct {
	ClientID     string
	ClientSecret string
	RedirectURI  string
	TokenPath    string
	Token        map[string]any
}

var GoogleFitScopes = []string{
	"https://www.googleapis.com/auth/fitness.body.read",
	"https://www.googleapis.com/auth/fitness.blood_pressure.read",
	"https://www.googleapis.com/auth/fitness.heart_rate.read",
	"https://www.googleapis.com/auth/fitness.temperature.read",
}

func CreateGoogleFitOAuthClient(settings config.GoogleFitAuthConfig) GoogleFitOAuthClient {
	return GoogleFitOAuthClient{
		ClientID:     settings.ClientID,
		ClientSecret: settings.ClientSecret,
		RedirectURI:  settings.RedirectURI,
		TokenPath:    settings.TokenPath,
	}
}

func LoadGoogleFitOAuthClient(settings config.GoogleFitAuthConfig) (GoogleFitOAuthClient, error) {
	client := CreateGoogleFitOAuthClient(settings)
	data, err := os.ReadFile(settings.TokenPath)
	if err != nil {
		return GoogleFitOAuthClient{}, err
	}
	var token map[string]any
	if err := json.Unmarshal(data, &token); err != nil {
		return GoogleFitOAuthClient{}, fmt.Errorf("invalid Google Fit token: %w", err)
	}
	client.Token = token
	return client, nil
}

func (client GoogleFitOAuthClient) OAuthToken() (*oauth2.Token, error) {
	encoded, err := json.Marshal(client.Token)
	if err != nil {
		return nil, err
	}
	var token oauth2.Token
	if err := json.Unmarshal(encoded, &token); err != nil {
		return nil, fmt.Errorf("invalid Google Fit token: %w", err)
	}
	if token.AccessToken == "" {
		return nil, fmt.Errorf("invalid Google Fit token: access_token is required")
	}
	return &token, nil
}

func (client GoogleFitOAuthClient) HTTPClient(ctx context.Context) (*http.Client, error) {
	token, err := client.OAuthToken()
	if err != nil {
		return nil, err
	}
	return oauth2.NewClient(ctx, oauth2.StaticTokenSource(token)), nil
}

func GoogleFitOAuthConfig(settings config.GoogleFitAuthConfig) *oauth2.Config {
	return &oauth2.Config{ClientID: settings.ClientID, ClientSecret: settings.ClientSecret, Endpoint: google.Endpoint, RedirectURL: settings.RedirectURI, Scopes: GoogleFitScopes}
}

type GoogleFitAuthOptions struct {
	Log         func(string)
	OpenBrowser func(string) error
}

// RunGoogleFitAuth performs the localhost OAuth callback flow and stores the
// resulting refresh token with owner-only permissions.
func RunGoogleFitAuth(ctx context.Context, settings config.GoogleFitAuthConfig, options GoogleFitAuthOptions) error {
	if ctx == nil {
		ctx = context.Background()
	}
	redirect, err := url.Parse(settings.RedirectURI)
	if err != nil {
		return fmt.Errorf("invalid Google Fit redirect URI: %w", err)
	}
	if redirect.Scheme != "http" || (redirect.Hostname() != "localhost" && redirect.Hostname() != "127.0.0.1") {
		return fmt.Errorf("GOOGLE_FIT_REDIRECT_URI must use localhost or 127.0.0.1 for CLI auth")
	}
	if redirect.Path == "" {
		redirect.Path = "/oauth2callback"
	}
	listener, err := net.Listen("tcp", redirect.Host)
	if err != nil {
		return fmt.Errorf("listen for Google Fit OAuth callback: %w", err)
	}

	state, err := randomURLToken(32)
	if err != nil {
		_ = listener.Close()
		return fmt.Errorf("create Google Fit OAuth state: %w", err)
	}
	verifier, err := randomURLToken(32)
	if err != nil {
		_ = listener.Close()
		return fmt.Errorf("create Google Fit OAuth verifier: %w", err)
	}
	oauthConfig := GoogleFitOAuthConfig(settings)
	authURL := oauthConfig.AuthCodeURL(state, oauth2.AccessTypeOffline, oauth2.ApprovalForce, oauth2.S256ChallengeOption(verifier))

	log := options.Log
	if log == nil {
		log = func(string) {}
	}
	result := make(chan error, 1)
	var completeOnce sync.Once
	complete := func(callbackErr error) {
		completeOnce.Do(func() { result <- callbackErr })
	}
	server := &http.Server{Handler: http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if request.URL.Path != redirect.Path {
			http.Error(response, "Not found.", http.StatusNotFound)
			return
		}
		query := request.URL.Query()
		if query.Get("state") != state {
			http.Error(response, "Invalid state.", http.StatusBadRequest)
			return
		}
		if providerError := query.Get("error"); providerError != "" {
			http.Error(response, "Authorization failed.", http.StatusBadRequest)
			complete(fmt.Errorf("Google Fit authorization failed: %s", providerError))
			return
		}
		code := query.Get("code")
		if code == "" {
			http.Error(response, "Missing authorization code.", http.StatusBadRequest)
			return
		}
		token, exchangeErr := oauthConfig.Exchange(request.Context(), code, oauth2.VerifierOption(verifier))
		if exchangeErr != nil {
			http.Error(response, "Authorization failed.", http.StatusInternalServerError)
			complete(fmt.Errorf("exchange Google Fit authorization code: %w", exchangeErr))
			return
		}
		if saveErr := SaveGoogleFitToken(settings.TokenPath, token); saveErr != nil {
			http.Error(response, "Authorization failed.", http.StatusInternalServerError)
			complete(saveErr)
			return
		}
		response.Header().Set("Content-Type", "text/plain; charset=utf-8")
		_, _ = response.Write([]byte("Google Fit authorization completed. You can close this tab."))
		complete(nil)
	})}
	serveErr := make(chan error, 1)
	go func() { serveErr <- server.Serve(listener) }()

	log("Open this URL in your browser to authorize Google Fit:")
	log(authURL)
	log("Waiting for callback on " + settings.RedirectURI)
	if options.OpenBrowser != nil {
		if openErr := options.OpenBrowser(authURL); openErr != nil {
			log("Could not open a browser automatically; open the URL above manually.")
		}
	}

	var callbackErr error
	select {
	case callbackErr = <-result:
	case <-ctx.Done():
		_ = server.Close()
		return ctx.Err()
	case err := <-serveErr:
		if err != nil && err != http.ErrServerClosed {
			return fmt.Errorf("serve Google Fit OAuth callback: %w", err)
		}
		return fmt.Errorf("Google Fit OAuth callback server stopped before authorization")
	}
	_ = server.Close()
	if callbackErr != nil {
		return callbackErr
	}
	log("Saved Google Fit token to " + settings.TokenPath)
	return nil
}

func randomURLToken(size int) (string, error) {
	data := make([]byte, size)
	if _, err := rand.Read(data); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(data), nil
}

func SaveGoogleFitToken(path string, token *oauth2.Token) error {
	if token == nil || token.AccessToken == "" {
		return fmt.Errorf("Google Fit token is empty")
	}
	data, err := json.MarshalIndent(token, "", "  ")
	if err != nil {
		return err
	}
	data = append(data, '\n')
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}
	if err := os.WriteFile(path, data, 0o600); err != nil {
		return err
	}
	return os.Chmod(path, 0o600)
}
