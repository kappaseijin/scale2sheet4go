package pipeline

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestAtomicPipelineStatusWriterRecordsFailureAndClaimsOnlyFirstAlert(t *testing.T) {
	path := filepath.Join(t.TempDir(), "pipeline-status.json")
	writer := NewAtomicPipelineStatusWriter(path, "run-1")
	started := "2026-06-18T06:00:00.000Z"
	completed := "2026-06-18T06:01:00.000Z"
	if _, err := writer.Write(PipelineStatus{Period: PeriodMorning, Outcome: "running", StartedAt: started, TargetDate: "2026-06-18"}); err != nil {
		t.Fatal(err)
	}
	result, err := writer.Write(PipelineStatus{
		Period:      PeriodMorning,
		Outcome:     "failed:transfer",
		StartedAt:   started,
		CompletedAt: &completed,
		TargetDate:  "2026-06-18",
		Diagnostic:  "timeout",
		V3:          &V3Observation{Input: "ready", WindowedWeightCount: 1, Transfer: V3TransferObservation{State: "failed"}},
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Notifications) != 1 || result.Notifications[0].Notification.ToState != "alert" {
		t.Fatalf("notifications = %#v, want one alert", result.Notifications)
	}
	result, err = writer.Write(PipelineStatus{
		Period:      PeriodMorning,
		Outcome:     "failed:transfer",
		StartedAt:   started,
		CompletedAt: &completed,
		TargetDate:  "2026-06-18",
		V3:          &V3Observation{Input: "ready", WindowedWeightCount: 1, Transfer: V3TransferObservation{State: "failed"}},
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Notifications) != 0 {
		t.Fatalf("repeated alert notifications = %#v, want none", result.Notifications)
	}

	document, err := ReadPipelineStatusDocument(path)
	if err != nil {
		t.Fatal(err)
	}
	if document.Periods[PeriodMorning].Health.State != "alert" || document.Periods[PeriodMorning].ConsecutiveFailureCount != 2 {
		t.Fatalf("document period = %#v", document.Periods[PeriodMorning])
	}
}

func TestAtomicPipelineStatusWriterAnnotatesInputInvalidNotification(t *testing.T) {
	path := filepath.Join(t.TempDir(), "pipeline-status.json")
	writer := NewAtomicPipelineStatusWriter(path, "run-input-invalid")
	started := "2026-06-18T06:00:00.000Z"
	completed := "2026-06-18T06:01:00.000Z"
	if _, err := writer.Write(PipelineStatus{Period: PeriodMorning, Outcome: "running", StartedAt: started, TargetDate: "2026-06-18"}); err != nil {
		t.Fatal(err)
	}
	result, err := writer.Write(PipelineStatus{
		Period:      PeriodMorning,
		Outcome:     string(OutcomeFailedInputInvalid),
		StartedAt:   started,
		CompletedAt: &completed,
		TargetDate:  "2026-06-18",
		Diagnostic:  "invalid JSON at file.jsonl:1",
		V3:          &V3Observation{Input: "unavailable", Transfer: V3TransferObservation{State: TransferNotAttempted}},
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Notifications) != 1 || result.Notifications[0].Notification.Reason != NotificationReasonInputInvalid {
		t.Fatalf("notifications = %#v, want input-invalid reason", result.Notifications)
	}
	document, err := ReadPipelineStatusDocument(path)
	if err != nil {
		t.Fatal(err)
	}
	if document.Periods[PeriodMorning].LastNotificationAttempt == nil || document.Periods[PeriodMorning].LastNotificationAttempt.Reason != NotificationReasonInputInvalid {
		t.Fatalf("last notification = %#v", document.Periods[PeriodMorning].LastNotificationAttempt)
	}
}

func TestParseDocumentRejectsNewerDefinitionsAndMalformedHealth(t *testing.T) {
	newer := map[string]any{"schemaVersion": 1, "definitionsVersion": 4, "definitionsLabel": "future", "periods": map[string]any{}}
	data, _ := json.Marshal(newer)
	if _, _, err := ParseDocument(data, "2026-06-18T00:00:00Z"); err == nil || !strings.Contains(err.Error(), "newer") {
		t.Fatalf("newer definitions error = %v", err)
	}
	malformed := []byte(`{"schemaVersion":1,"definitionsVersion":3,"definitionsLabel":"x","periods":{"morning":{},"evening":{}}}`)
	if _, _, err := ParseDocument(malformed, "2026-06-18T00:00:00Z"); err == nil {
		t.Fatal("malformed health unexpectedly parsed")
	}
}

func TestReadPipelineStatusDocumentReturnsNilWhenMissing(t *testing.T) {
	got, err := ReadPipelineStatusDocument(filepath.Join(t.TempDir(), "missing.json"))
	if err != nil || got != nil {
		t.Fatalf("document, err = %#v, %v; want nil, nil", got, err)
	}
}

func TestAtomicPipelineStatusWriterUsesPrivateFile(t *testing.T) {
	path := filepath.Join(t.TempDir(), "status.json")
	writer := NewAtomicPipelineStatusWriter(path, "run")
	if _, err := writer.Write(PipelineStatus{Period: PeriodMorning, Outcome: "running", StartedAt: "2026-06-18T00:00:00Z", TargetDate: "2026-06-18"}); err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0o600 {
		t.Fatalf("status mode = %o, want 600", info.Mode().Perm())
	}
}
