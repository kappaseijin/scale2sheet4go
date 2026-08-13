package pipeline

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestReadStableInputSnapshotReadsStableTargetFiles(t *testing.T) {
	dir := t.TempDir()
	name := "scale_exporter_2026-06-18_apple-health_001.jsonl"
	content := `{"measuredAt":"2026-06-18T06:50:00+09:00","kind":"weight","value":68.6,"unit":"kg","source":"apple_health"}` + "\n"
	if err := os.WriteFile(filepath.Join(dir, name), []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}
	got, err := ReadStableInputSnapshot(ReadStableInputSnapshotOptions{
		OutputDir:  dir,
		TargetDate: "2026-06-18",
		Delay:      func(time.Duration) {},
	})
	if err != nil {
		t.Fatal(err)
	}
	if got.MatchedFileCount != 1 || got.ReadLineCount != 1 || len(got.Readings) != 1 {
		t.Fatalf("snapshot = %#v, want one file/line/reading", got)
	}
}

func TestReadStableInputSnapshotReportsMissingInputAfterRetries(t *testing.T) {
	_, err := ReadStableInputSnapshot(ReadStableInputSnapshotOptions{
		OutputDir:  filepath.Join(t.TempDir(), "missing"),
		TargetDate: "2026-06-18",
		Delay:      func(time.Duration) {},
	})
	if err == nil {
		t.Fatal("ReadStableInputSnapshot() unexpectedly succeeded")
	}
	inputErr, ok := err.(*InputSnapshotError)
	if !ok || inputErr.Outcome != "input-missing" || !strings.Contains(inputErr.Error(), "2026-06-18") {
		t.Fatalf("error = %T %v, want input-missing with target date", err, err)
	}
}

func TestReadStableInputSnapshotReportsInvalidLineCount(t *testing.T) {
	dir := t.TempDir()
	name := "scale_exporter_2026-06-18_apple-health_001.jsonl"
	if err := os.WriteFile(filepath.Join(dir, name), []byte("not-json\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	_, err := ReadStableInputSnapshot(ReadStableInputSnapshotOptions{
		OutputDir:  dir,
		TargetDate: "2026-06-18",
		Delay:      func(time.Duration) {},
	})
	inputErr, ok := err.(*InputSnapshotError)
	if !ok || inputErr.Outcome != "input-invalid-or-partial" || inputErr.Counts.ReadLineCount != 1 {
		t.Fatalf("error = %#v, want invalid input with one read line", err)
	}
}
