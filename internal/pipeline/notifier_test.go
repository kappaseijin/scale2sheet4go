package pipeline

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestMacOSNotifierTreatsMissingExecutableAsBestEffort(t *testing.T) {
	if err := NewMacOSNotifier(filepathDoesNotExist()).Notify(PeriodMorning, "normal", "alert", ""); err != nil {
		t.Fatalf("Notify() error = %v", err)
	}
}

func TestMacOSNotifierWarnsWhenInputIsInvalid(t *testing.T) {
	dir := t.TempDir()
	executable := filepath.Join(dir, "osascript")
	recorded := filepath.Join(dir, "recorded-script")
	script := "#!/bin/sh\nprintf '%s\\n' \"$2\" > " + shellQuote(recorded) + "\n"
	if err := os.WriteFile(executable, []byte(script), 0o700); err != nil {
		t.Fatal(err)
	}

	if err := NewMacOSNotifier(executable).Notify(PeriodMorning, "normal", "alert", NotificationReasonInputInvalid); err != nil {
		t.Fatalf("Notify() error = %v", err)
	}
	data, err := os.ReadFile(recorded)
	if err != nil {
		t.Fatal(err)
	}
	message := string(data)
	if !strings.Contains(message, "入力全体を信用できないため、転記していません") {
		t.Fatalf("notification script = %q", message)
	}
	if !strings.Contains(message, "period=morning") {
		t.Fatalf("notification script = %q", message)
	}
}

func shellQuote(value string) string {
	return "'" + strings.ReplaceAll(value, "'", "'\"'\"'") + "'"
}

func filepathDoesNotExist() string { return "/definitely/missing/scale2sheet-osascript" }
