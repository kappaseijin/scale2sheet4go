package config

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestSettingsFileContract(t *testing.T) {
	t.Run("parses supported keys and ignores unknown keys", func(t *testing.T) {
		settings, err := ParseSettingsFile([]byte(`{
  "time-zone": "Asia/Tokyo",
  "source": "apple-health",
  "google-fit-lookback-days": 14,
  "unknown-key": "preserved by the loose settings contract"
}`), "/tmp/settings.json")
		if err != nil {
			t.Fatal(err)
		}
		if settings.TimeZone == nil || *settings.TimeZone != "Asia/Tokyo" {
			t.Fatalf("time zone = %#v", settings.TimeZone)
		}
		if settings.Source == nil || *settings.Source != "apple-health" {
			t.Fatalf("source = %#v", settings.Source)
		}
		if settings.GoogleFitLookbackDays == nil || *settings.GoogleFitLookbackDays != 14 {
			t.Fatalf("lookback = %#v", settings.GoogleFitLookbackDays)
		}
	})

	t.Run("rejects malformed JSON with path context", func(t *testing.T) {
		_, err := ParseSettingsFile([]byte(`{"time-zone":`), "/tmp/settings.json")
		if err == nil || !strings.Contains(err.Error(), "/tmp/settings.json") {
			t.Fatalf("error = %v, want path context", err)
		}
		if _, ok := err.(*ConfigError); !ok {
			t.Fatalf("error type = %T, want *ConfigError", err)
		}
	})

	t.Run("expands home paths", func(t *testing.T) {
		if got := ExpandHomePath("~", "/Users/tester"); got != "/Users/tester" {
			t.Fatalf("ExpandHomePath(~) = %q", got)
		}
		if got := ExpandHomePath("~/config/settings.json", "/Users/tester"); got != "/Users/tester/config/settings.json" {
			t.Fatalf("ExpandHomePath(~/...) = %q", got)
		}
		if got := ExpandHomePath("/tmp/settings.json", "/Users/tester"); got != "/tmp/settings.json" {
			t.Fatalf("ExpandHomePath(absolute) = %q", got)
		}
	})

	t.Run("creates default settings without product-specific required values", func(t *testing.T) {
		dir := t.TempDir()
		path := filepath.Join(dir, "settings.json")
		settings, err := LoadOrCreateSettings(path)
		if err != nil {
			t.Fatal(err)
		}
		if settings.Source == nil || *settings.Source != "scale-exporter" {
			t.Fatalf("source = %#v", settings.Source)
		}
		if settings.SheetID != nil || settings.ScaleExporterOutputDir != nil {
			t.Fatalf("default settings unexpectedly include required values: %#v", settings)
		}
		if _, err := os.Stat(path); err != nil {
			t.Fatalf("settings file was not created: %v", err)
		}
	})
}
