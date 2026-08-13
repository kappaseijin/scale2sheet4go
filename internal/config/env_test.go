package config

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestLoadConfig(t *testing.T) {
	t.Run("environment values override settings values", func(t *testing.T) {
		dir := t.TempDir()
		settingsPath := filepath.Join(dir, "settings.json")
		if err := os.WriteFile(settingsPath, []byte(`{
  "time-zone": "UTC",
  "source": "scale-exporter",
  "sheet-id": "sheet-from-settings",
  "sheets-credentials": "~/settings-key.json",
  "scale-exporter-output-dir": "~/settings-output",
  "morning-cron": "0 6 * * *"
}`), 0o644); err != nil {
			t.Fatal(err)
		}
		env := map[string]string{
			"TIME_ZONE":                      "Asia/Tokyo",
			"GOOGLE_SHEET_ID":                "sheet-from-env",
			"GOOGLE_APPLICATION_CREDENTIALS": "~/env-key.json",
			"SCALE_EXPORTER_OUTPUT_DIR":      "/tmp/env-output",
		}
		config, err := Load(settingsPath, env)
		if err != nil {
			t.Fatal(err)
		}
		if config.TimeZone != "Asia/Tokyo" || config.GoogleSheets == nil || config.GoogleSheets.SpreadsheetID != "sheet-from-env" {
			t.Fatalf("config = %#v", config)
		}
		if config.GoogleSheets.ApplicationCredentialsPath != filepath.Join(homeDir(), "env-key.json") {
			t.Fatalf("credentials path = %q", config.GoogleSheets.ApplicationCredentialsPath)
		}
		if config.ScaleExporter == nil || config.ScaleExporter.OutputDir != "/tmp/env-output" {
			t.Fatalf("scale exporter config = %#v", config.ScaleExporter)
		}
		if config.Scheduler.MorningCron != "0 6 * * *" {
			t.Fatalf("morning cron = %q", config.Scheduler.MorningCron)
		}
	})

	t.Run("defaults are stable", func(t *testing.T) {
		config, err := Load(filepath.Join(t.TempDir(), "missing-settings.json"), map[string]string{})
		if err != nil {
			t.Fatal(err)
		}
		if config.TimeZone != "Asia/Tokyo" || config.DefaultSource != "scale-exporter" {
			t.Fatalf("defaults = %#v", config)
		}
		if config.Scheduler.MorningCron != "0 7 * * *" || config.Scheduler.EveningCron != "0 21 * * *" {
			t.Fatalf("scheduler defaults = %#v", config.Scheduler)
		}
	})

	t.Run("invalid lookback is a configuration error", func(t *testing.T) {
		_, err := Load(filepath.Join(t.TempDir(), "settings.json"), map[string]string{"GOOGLE_FIT_LOOKBACK_DAYS": "0"})
		if err == nil || !strings.Contains(err.Error(), "GOOGLE_FIT_LOOKBACK_DAYS") {
			t.Fatalf("error = %v, want lookback context", err)
		}
		if _, ok := err.(*ConfigError); !ok {
			t.Fatalf("error type = %T, want *ConfigError", err)
		}
	})
}

func TestRequireConfig(t *testing.T) {
	base := AppConfig{TimeZone: "Asia/Tokyo", DefaultSource: "scale-exporter", Scheduler: SchedulerConfig{MorningCron: "0 7 * * *", EveningCron: "0 21 * * *"}}
	if _, err := RequireGoogleSheetsConfig(base); err == nil {
		t.Fatal("RequireGoogleSheetsConfig() unexpectedly succeeded")
	}
	if _, err := RequireScaleExporterConfig(base); err == nil {
		t.Fatal("RequireScaleExporterConfig() unexpectedly succeeded")
	}
	if _, err := RequireAppleHealthConfig(base); err == nil {
		t.Fatal("RequireAppleHealthConfig() unexpectedly succeeded")
	}
	if _, err := RequireGoogleFitConfig(base); err == nil {
		t.Fatal("RequireGoogleFitConfig() unexpectedly succeeded")
	}

	base.GoogleSheets = &GoogleSheetsAuthConfig{ApplicationCredentialsPath: "/tmp/key.json", SpreadsheetID: "sheet", SheetName: "体温・血圧"}
	base.ScaleExporter = &ScaleExporterConfig{OutputDir: "/tmp/output"}
	base.AppleHealth = &AppleHealthConfig{ExportXMLPath: "/tmp/export.xml"}
	base.GoogleFit = &GoogleFitAuthConfig{ClientID: "id", ClientSecret: "secret", RedirectURI: "http://localhost:3000/oauth2callback", TokenPath: "/tmp/token.json", LookbackDays: 14}
	if _, err := RequireGoogleSheetsConfig(base); err != nil {
		t.Fatal(err)
	}
	if _, err := RequireScaleExporterConfig(base); err != nil {
		t.Fatal(err)
	}
	if _, err := RequireAppleHealthConfig(base); err != nil {
		t.Fatal(err)
	}
	if _, err := RequireGoogleFitConfig(base); err != nil {
		t.Fatal(err)
	}
}

func homeDir() string {
	if home, err := os.UserHomeDir(); err == nil {
		return home
	}
	return ""
}
