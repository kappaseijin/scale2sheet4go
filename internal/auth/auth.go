package auth

import (
	"encoding/json"
	"fmt"
	"os"

	"github.com/kappaseijin/scale2sheet4go/internal/config"
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
