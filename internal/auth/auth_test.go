package auth

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/kappaseijin/scale2sheet4go/internal/config"
)

func TestGoogleFitCredentialsAndToken(t *testing.T) {
	dir := t.TempDir()
	credentialsPath := filepath.Join(dir, "google-fit-credentials.json")
	if err := os.WriteFile(credentialsPath, []byte(`{"client_id":"id","client_secret":"secret","redirect_uri":"http://localhost:3000/oauth2callback"}`), 0o600); err != nil {
		t.Fatal(err)
	}
	credentials, err := config.LoadGoogleFitCredentials(dir)
	if err != nil {
		t.Fatal(err)
	}
	if credentials == nil || credentials.ClientID != "id" || credentials.ClientSecret != "secret" || credentials.RedirectURI == "" {
		t.Fatalf("credentials = %#v", credentials)
	}

	tokenPath := filepath.Join(dir, "token.json")
	if err := os.WriteFile(tokenPath, []byte(`{"access_token":"secret-value","token_type":"Bearer"}`), 0o600); err != nil {
		t.Fatal(err)
	}
	client, err := LoadGoogleFitOAuthClient(config.GoogleFitAuthConfig{
		ClientID: "id", ClientSecret: "secret", RedirectURI: "http://localhost:3000/oauth2callback", TokenPath: tokenPath, LookbackDays: 14,
	})
	if err != nil {
		t.Fatal(err)
	}
	if client.ClientID != "id" || client.TokenPath != tokenPath {
		t.Fatalf("client = %#v", client)
	}
}

func TestGoogleSheetsAuthDescriptor(t *testing.T) {
	descriptor := CreateGoogleSheetsAuth(config.GoogleSheetsAuthConfig{
		ApplicationCredentialsPath: "/tmp/service-account.json",
		SpreadsheetID:              "sheet-id",
		SheetName:                  "体温・血圧",
	})
	if descriptor.CredentialsPath != "/tmp/service-account.json" || descriptor.SpreadsheetID != "sheet-id" || descriptor.SheetName != "体温・血圧" {
		t.Fatalf("descriptor = %#v", descriptor)
	}
}
