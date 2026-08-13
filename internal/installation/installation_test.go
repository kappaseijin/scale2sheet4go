package installation

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestLaunchdReadyValidatesSelectedSourceConfiguration(t *testing.T) {
	tests := []struct {
		name       string
		source     string
		additional map[string]any
		wantIssue  string
	}{
		{name: "apple health", source: "apple-health", wantIssue: "source-config-missing (apple-health)"},
		{name: "google fit", source: "google-fit", wantIssue: "source-config-missing (google-fit)"},
		{name: "unknown source", source: "other", wantIssue: "source-config-missing (other)"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			dir := t.TempDir()
			configDir := filepath.Join(dir, ".config", "scale2sheet")
			if err := os.MkdirAll(configDir, 0o700); err != nil {
				t.Fatal(err)
			}
			credentials := filepath.Join(configDir, "google-sheets-service-account.json")
			if err := os.WriteFile(credentials, []byte("{}\n"), 0o600); err != nil {
				t.Fatal(err)
			}
			settings := map[string]any{
				"source":                    tt.source,
				"sheet-id":                  "fixture-sheet",
				"sheets-credentials":        credentials,
				"google-fit-token-path":     filepath.Join(configDir, "google-fit-token.json"),
				"scale-exporter-output-dir": filepath.Join(dir, "output"),
			}
			for key, value := range tt.additional {
				settings[key] = value
			}
			data, err := json.Marshal(settings)
			if err != nil {
				t.Fatal(err)
			}
			settingsPath := filepath.Join(configDir, "settings.json")
			if err := os.WriteFile(settingsPath, data, 0o600); err != nil {
				t.Fatal(err)
			}

			ready, issues := LaunchdReady(settingsPath, configDir)
			if ready || !containsIssue(issues, tt.wantIssue) {
				t.Fatalf("LaunchdReady() = ready=%v issues=%v, want %q", ready, issues, tt.wantIssue)
			}
		})
	}
}

func TestLaunchdReadyAcceptsGoogleFitCredentialsFile(t *testing.T) {
	dir := t.TempDir()
	configDir := filepath.Join(dir, ".config", "scale2sheet")
	if err := os.MkdirAll(configDir, 0o700); err != nil {
		t.Fatal(err)
	}
	sheetsCredentials := filepath.Join(configDir, "google-sheets-service-account.json")
	if err := os.WriteFile(sheetsCredentials, []byte("{}\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	outputDir := filepath.Join(dir, "output")
	if err := os.MkdirAll(outputDir, 0o700); err != nil {
		t.Fatal(err)
	}
	settingsPath := filepath.Join(configDir, "settings.json")
	settings := map[string]any{
		"source":                      "google-fit",
		"sheet-id":                    "fixture-sheet",
		"sheets-credentials":          sheetsCredentials,
		"google-fit-token-path":       filepath.Join(configDir, "google-fit-token.json"),
		"google-fit-credentials-file": "ignored",
	}
	data, err := json.Marshal(settings)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(settingsPath, data, 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(configDir, "google-fit-credentials.json"), []byte(`{"client_id":"id","client_secret":"secret"}`), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(configDir, "google-fit-token.json"), []byte(`{"access_token":"token"}`), 0o600); err != nil {
		t.Fatal(err)
	}

	ready, issues := LaunchdReady(settingsPath, configDir)
	if !ready || len(issues) != 0 {
		t.Fatalf("LaunchdReady() = ready=%v issues=%v, want ready", ready, issues)
	}
}

func containsIssue(issues []string, want string) bool {
	for _, issue := range issues {
		if strings.Contains(issue, want) {
			return true
		}
	}
	return false
}
