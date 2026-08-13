package scaleexporter

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/kappaseijin/scale2sheet4go/internal/domain"
)

func TestReadMeasurements(t *testing.T) {
	timeZone := time.FixedZone("JST", 9*60*60)
	referenceTime := time.Date(2026, 6, 18, 12, 0, 0, 0, timeZone)

	t.Run("reads split sequence files and maps fields", func(t *testing.T) {
		dir := t.TempDir()
		writeJSONL(t, dir, "scale_exporter_2026-06-18_apple-health_001.jsonl", []string{
			line("2026-06-18T06:50:00+09:00", "weight", 68.6, "kg", "apple_health"),
			line("2026-06-18T06:51:00+09:00", "bodyTemperature", 36.4, "celsius", "apple_health"),
		})
		writeJSONL(t, dir, "scale_exporter_2026-06-18_google-fit_001.jsonl", []string{
			line("2026-06-18T06:52:00+09:00", "bloodPressureSystolic", 118, "mmHg", "google_fit"),
			line("2026-06-18T06:52:00+09:00", "bloodPressureDiastolic", 76, "mmHg", "google_fit"),
		})
		writeJSONL(t, dir, "scale_exporter_2026-06-18_google-fit_002.jsonl", []string{
			line("2026-06-18T06:53:00+09:00", "heartRate", 62, "bpm", "google_fit"),
		})

		readings, err := ReadMeasurements(Config{OutputDir: dir}, referenceTime, timeZone)
		if err != nil {
			t.Fatal(err)
		}
		if len(readings) != 5 {
			t.Fatalf("len(readings) = %d, want 5", len(readings))
		}
		if got := findReading(readings, domain.KindWeight).Source; got != "apple_health" {
			t.Fatalf("weight source = %q, want apple_health", got)
		}
		if got := findReading(readings, domain.KindPulse).Source; got != "google_fit" {
			t.Fatalf("pulse source = %q, want google_fit", got)
		}
	})

	t.Run("ignores other dates and unrelated entries", func(t *testing.T) {
		dir := t.TempDir()
		writeJSONL(t, dir, "scale_exporter_2026-06-17_apple-health_001.jsonl", []string{
			line("2026-06-17T06:50:00+09:00", "weight", 68, "kg", "apple_health"),
		})
		writeJSONL(t, dir, "notes.txt", []string{"not a reading"})
		if err := os.Mkdir(filepath.Join(dir, "scale_exporter_2026-06-18_apple-health_002.jsonl.d"), 0o755); err != nil {
			t.Fatal(err)
		}
		writeJSONL(t, dir, "scale_exporter_2026-06-18_apple-health_001.jsonl", []string{
			line("2026-06-18T06:50:00+09:00", "weight", 68.6, "kg", "apple_health"),
		})
		readings, err := ReadMeasurements(Config{OutputDir: dir}, referenceTime, timeZone)
		if err != nil {
			t.Fatal(err)
		}
		if len(readings) != 1 {
			t.Fatalf("len(readings) = %d, want 1", len(readings))
		}
	})

	t.Run("deduplicates identical records across files", func(t *testing.T) {
		dir := t.TempDir()
		duplicated := line("2026-06-18T06:50:00+09:00", "weight", 68.6, "kg", "google_fit")
		writeJSONL(t, dir, "scale_exporter_2026-06-18_google-fit_001.jsonl", []string{duplicated})
		writeJSONL(t, dir, "scale_exporter_2026-06-18_google-fit_002.jsonl", []string{
			duplicated,
			line("2026-06-18T06:55:00+09:00", "weight", 68.4, "kg", "google_fit"),
		})
		readings, err := ReadMeasurements(Config{OutputDir: dir}, referenceTime, timeZone)
		if err != nil {
			t.Fatal(err)
		}
		if len(readings) != 2 {
			t.Fatalf("len(readings) = %d, want 2", len(readings))
		}
	})

	t.Run("missing directory is empty", func(t *testing.T) {
		readings, err := ReadMeasurements(Config{OutputDir: filepath.Join(t.TempDir(), "missing")}, referenceTime, timeZone)
		if err != nil {
			t.Fatal(err)
		}
		if len(readings) != 0 {
			t.Fatalf("len(readings) = %d, want 0", len(readings))
		}
	})

	t.Run("invalid JSON and schema return file context", func(t *testing.T) {
		dir := t.TempDir()
		fileName := "scale_exporter_2026-06-18_apple-health_001.jsonl"
		writeJSONL(t, dir, fileName, []string{"not json"})
		_, err := ReadMeasurements(Config{OutputDir: dir}, referenceTime, timeZone)
		if err == nil || !strings.Contains(err.Error(), fileName+":1") {
			t.Fatalf("invalid JSON error = %v, want file and line context", err)
		}

		writeJSONL(t, dir, fileName, []string{`{"measuredAt":"2026-06-18T06:50:00+09:00","kind":"steps","value":100,"unit":"kg","source":"apple_health"}`})
		_, err = ReadMeasurements(Config{OutputDir: dir}, referenceTime, timeZone)
		if err == nil || !strings.Contains(err.Error(), fileName+":1") {
			t.Fatalf("schema error = %v, want file and line context", err)
		}
	})
}

func TestClassifyFileNames(t *testing.T) {
	got := ClassifyFileNames([]string{
		"scale_exporter_2026-06-18_apple-health-file_001.jsonl",
		"scale_exporter_2026-06-18_google-fit_001.jsonlのコピー2",
		"scale_exporter_2026-06-18_google-fit_001.jsonl",
		"scale_exporter_2026-06-18_apple-health-file_001.jsonl",
		"scale_exporter_2026-06-18_google-fit_001.jsonlのコピー",
		".DS_Store",
	}, "2026-06-18")
	if len(got.TargetFileNames) != 1 || got.TargetFileNames[0] != "scale_exporter_2026-06-18_google-fit_001.jsonl" {
		t.Fatalf("target files = %#v", got.TargetFileNames)
	}
	if len(got.InputAnomalyCandidates) != 1 || got.InputAnomalyCandidates[0].Name != "scale_exporter_2026-06-18_apple-health-file_001.jsonl" {
		t.Fatalf("anomaly candidates = %#v", got.InputAnomalyCandidates)
	}
}

func TestParseReadingLine(t *testing.T) {
	reading, err := ParseReadingLine(line("2026-06-18T06:50:00+09:00", "heartRate", 62, "bpm", "omron connect"), "input.jsonl", 3)
	if err != nil {
		t.Fatal(err)
	}
	if reading.Kind != domain.KindPulse || reading.Value != 62 || reading.Source != "omron connect" {
		t.Fatalf("reading = %#v", reading)
	}
}

func writeJSONL(t *testing.T, dir, name string, lines []string) {
	t.Helper()
	if err := os.WriteFile(filepath.Join(dir, name), []byte(strings.Join(lines, "\n")+"\n"), 0o644); err != nil {
		t.Fatal(err)
	}
}

func line(measuredAt, kind string, value float64, unit, source string) string {
	b, _ := json.Marshal(map[string]any{
		"measuredAt": measuredAt,
		"kind":       kind,
		"value":      value,
		"unit":       unit,
		"source":     source,
	})
	return string(b)
}

func findReading(readings []domain.MeasurementReading, kind domain.MeasurementKind) domain.MeasurementReading {
	for _, reading := range readings {
		if reading.Kind == kind {
			return reading
		}
	}
	return domain.MeasurementReading{}
}
