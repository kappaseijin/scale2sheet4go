package pipeline

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"time"

	"github.com/kappaseijin/scale2sheet4go/internal/sources/scaleexporter"
)

type PipelinePeriod string

const (
	PeriodMorning PipelinePeriod = "morning"
	PeriodEvening PipelinePeriod = "evening"
)

type PipelineCounts struct {
	MatchedFileCount       int `json:"matchedFileCount"`
	ReadLineCount          int `json:"readLineCount"`
	WindowedReadingCount   int `json:"windowedReadingCount"`
	UniqueMeasurementCount int `json:"uniqueMeasurementCount"`
	present                uint8
}

const (
	countMatched uint8 = 1 << iota
	countReadLines
	countWindowed
	countUnique
	countAll = countMatched | countReadLines | countWindowed | countUnique
)

func AllPipelineCounts(matchedFiles, readLines, windowedReadings, uniqueMeasurements int) PipelineCounts {
	return PipelineCounts{MatchedFileCount: matchedFiles, ReadLineCount: readLines, WindowedReadingCount: windowedReadings, UniqueMeasurementCount: uniqueMeasurements, present: countAll}
}

func InputPipelineCounts(matchedFiles, readLines int) PipelineCounts {
	counts := PipelineCounts{MatchedFileCount: matchedFiles, ReadLineCount: readLines}
	counts.present = countMatched
	if readLines != 0 {
		counts.present |= countReadLines
	}
	return counts
}

func (c PipelineCounts) MarshalJSON() ([]byte, error) {
	present := c.present
	if present == 0 {
		if c.MatchedFileCount != 0 {
			present |= countMatched
		}
		if c.ReadLineCount != 0 {
			present |= countReadLines
		}
		if c.WindowedReadingCount != 0 {
			present |= countWindowed
		}
		if c.UniqueMeasurementCount != 0 {
			present |= countUnique
		}
	}
	values := make(map[string]int, 4)
	if present&countMatched != 0 {
		values["matchedFileCount"] = c.MatchedFileCount
	}
	if present&countReadLines != 0 {
		values["readLineCount"] = c.ReadLineCount
	}
	if present&countWindowed != 0 {
		values["windowedReadingCount"] = c.WindowedReadingCount
	}
	if present&countUnique != 0 {
		values["uniqueMeasurementCount"] = c.UniqueMeasurementCount
	}
	return json.Marshal(values)
}

func (c *PipelineCounts) UnmarshalJSON(data []byte) error {
	var values map[string]int
	if err := json.Unmarshal(data, &values); err != nil {
		return err
	}
	c.MatchedFileCount, c.ReadLineCount, c.WindowedReadingCount, c.UniqueMeasurementCount = values["matchedFileCount"], values["readLineCount"], values["windowedReadingCount"], values["uniqueMeasurementCount"]
	c.present = 0
	if _, ok := values["matchedFileCount"]; ok {
		c.present |= countMatched
	}
	if _, ok := values["readLineCount"]; ok {
		c.present |= countReadLines
	}
	if _, ok := values["windowedReadingCount"]; ok {
		c.present |= countWindowed
	}
	if _, ok := values["uniqueMeasurementCount"]; ok {
		c.present |= countUnique
	}
	return nil
}

type V3TransferState string

const (
	TransferNotAttempted V3TransferState = "not-attempted"
	TransferWritten      V3TransferState = "written"
	TransferNotWritten   V3TransferState = "not-written"
	TransferFailed       V3TransferState = "failed"
	TransferUnknown      V3TransferState = "unknown"
)

type V3TransferObservation struct {
	State                V3TransferState `json:"state"`
	RequestedCellCount   *int            `json:"requestedCellCount,omitempty"`
	TransferredCellCount *int            `json:"transferredCellCount,omitempty"`
}

type V3Observation struct {
	Input               string                `json:"input"`
	WindowedWeightCount int                   `json:"windowedWeightCount"`
	Transfer            V3TransferObservation `json:"transfer"`
}

type PipelineStatus struct {
	Period                 PipelinePeriod
	Outcome                string
	StartedAt              string
	CompletedAt            *string
	TargetDate             string
	Counts                 PipelineCounts
	PartialInput           bool
	Diagnostic             string
	InputAnomalyCandidates []scaleexporter.InputAnomalyCandidate
	V3                     *V3Observation
}

type PersistedPipelineOutcome string

const (
	OutcomeCompletedNoData      PersistedPipelineOutcome = "completed:no-data"
	OutcomeCompletedTransferred PersistedPipelineOutcome = "completed:transferred"
	OutcomeFailedInputMissing   PersistedPipelineOutcome = "failed:input-missing"
	OutcomeFailedInputUnstable  PersistedPipelineOutcome = "failed:input-unstable"
	OutcomeFailedInputInvalid   PersistedPipelineOutcome = "failed:input-invalid-or-partial"
	OutcomeFailedTransfer       PersistedPipelineOutcome = "failed:transfer"
)

type HealthCause string

const (
	HealthCauseTerminalFailure   HealthCause = "terminal-failure"
	HealthCauseV3NotTransferred  HealthCause = "v3-not-transferred"
	HealthCauseV1Stale           HealthCause = "v1-stale"
	HealthCauseConsecutiveNoData HealthCause = "consecutive-no-data"
	HealthCauseInputAnomaly      HealthCause = "input-anomaly-candidates"
)

type HealthStatus struct {
	State  string        `json:"state"`
	Causes []HealthCause `json:"causes"`
}

type ActiveRun struct {
	RunID      string `json:"runId"`
	StartedAt  string `json:"startedAt"`
	TargetDate string `json:"targetDate"`
}

type InterruptedRun struct {
	RunID      string `json:"runId"`
	StartedAt  string `json:"startedAt"`
	TargetDate string `json:"targetDate"`
	ObservedAt string `json:"observedAt"`
}

type TerminalObservation struct {
	RunID                  string                                `json:"runId"`
	Outcome                PersistedPipelineOutcome              `json:"outcome"`
	StartedAt              string                                `json:"startedAt"`
	CompletedAt            string                                `json:"completedAt"`
	TargetDate             string                                `json:"targetDate"`
	Counts                 PipelineCounts                        `json:"counts"`
	PartialInput           bool                                  `json:"partialInput,omitempty"`
	Diagnostic             string                                `json:"diagnostic,omitempty"`
	InputAnomalyCandidates []scaleexporter.InputAnomalyCandidate `json:"inputAnomalyCandidates,omitempty"`
	V3                     *V3Observation                        `json:"v3,omitempty"`
}

type NotificationAttempt struct {
	AttemptID string `json:"attemptId"`
	ClaimedAt string `json:"claimedAt"`
	Result    string `json:"result"`
	Trigger   string `json:"trigger"`
	FromState string `json:"fromState,omitempty"`
	ToState   string `json:"toState"`
}

type NotificationDiagnostic struct {
	Code              string `json:"code"`
	ObservedAt        string `json:"observedAt"`
	LastTerminalRunID string `json:"lastTerminalRunId"`
}

type PeriodStatus struct {
	ConsecutiveFailureCount    int                     `json:"consecutiveFailureCount"`
	ConsecutiveNoDataCount     int                     `json:"consecutiveNoDataCount"`
	Health                     HealthStatus            `json:"health"`
	ActiveRun                  *ActiveRun              `json:"activeRun,omitempty"`
	LastInterruptedRun         *InterruptedRun         `json:"lastInterruptedRun,omitempty"`
	LastTerminal               *TerminalObservation    `json:"lastTerminal,omitempty"`
	LastDoneAt                 string                  `json:"lastDoneAt,omitempty"`
	LastTransferredAt          string                  `json:"lastTransferredAt,omitempty"`
	LastNotificationDiagnostic *NotificationDiagnostic `json:"lastNotificationDiagnostic,omitempty"`
	LastNotificationAttempt    *NotificationAttempt    `json:"lastNotificationAttempt,omitempty"`
}

type DefinitionsTransition struct {
	FromVersion int    `json:"fromVersion"`
	ToVersion   int    `json:"toVersion"`
	ChangedAt   string `json:"changedAt"`
}

type PipelineStatusDocument struct {
	SchemaVersion             int                             `json:"schemaVersion"`
	DefinitionsVersion        int                             `json:"definitionsVersion"`
	DefinitionsLabel          string                          `json:"definitionsLabel"`
	UpdatedAt                 string                          `json:"updatedAt"`
	Periods                   map[PipelinePeriod]PeriodStatus `json:"periods"`
	LastDefinitionsTransition *DefinitionsTransition          `json:"lastDefinitionsTransition,omitempty"`
}

type PipelineStatusSchemaError struct{ Message string }

func (e *PipelineStatusSchemaError) Error() string { return e.Message }

const (
	CurrentDefinitionsVersion = 3
	CurrentDefinitionsLabel   = "2026-08-05/v3-transfer-observation"
)

type NotificationDelivery struct {
	Period       PipelinePeriod
	Notification NotificationAttempt
}

type PipelineStatusWriteResult struct {
	Notifications []NotificationDelivery
}

type PipelineStatusWriter interface {
	Write(status PipelineStatus) (PipelineStatusWriteResult, error)
}

type AtomicPipelineStatusWriter struct {
	StatusPath string
	RunID      string
	RenameFile func(string, string) error
}

func NewAtomicPipelineStatusWriter(statusPath, runID string) *AtomicPipelineStatusWriter {
	return &AtomicPipelineStatusWriter{StatusPath: statusPath, RunID: runID, RenameFile: os.Rename}
}

func (w *AtomicPipelineStatusWriter) Write(status PipelineStatus) (PipelineStatusWriteResult, error) {
	if w == nil || w.StatusPath == "" {
		return PipelineStatusWriteResult{}, errors.New("pipeline status path is required")
	}
	updatedAt := status.StartedAt
	if status.CompletedAt != nil {
		updatedAt = *status.CompletedAt
	}
	read, err := w.readDocument(updatedAt)
	if err != nil {
		return PipelineStatusWriteResult{}, err
	}
	document := RebaselineForDefinitions(read.Document, updatedAt)
	recovered := read.RecoveredNotifications
	if document.DefinitionsVersion != read.Document.DefinitionsVersion {
		recovered = map[PipelinePeriod]NotificationAttempt{}
	}
	var next PipelineStatusDocument
	var own *NotificationAttempt
	if status.Outcome == "running" {
		next = RecordActiveRun(document, status, w.RunID, updatedAt)
	} else {
		var terminalResult TerminalRecordResult
		terminalResult, err = RecordTerminal(document, status, w.RunID, updatedAt)
		if err != nil {
			return PipelineStatusWriteResult{}, err
		}
		next = terminalResult.Document
		own = terminalResult.Notification
	}
	encoded, err := json.MarshalIndent(next, "", "  ")
	if err != nil {
		return PipelineStatusWriteResult{}, err
	}
	encoded = append(encoded, '\n')
	if err := os.MkdirAll(filepath.Dir(w.StatusPath), 0o755); err != nil {
		return PipelineStatusWriteResult{}, err
	}
	temporaryPath := w.StatusPath + "." + strconv.Itoa(os.Getpid()) + ".tmp"
	if err := os.WriteFile(temporaryPath, encoded, 0o600); err != nil {
		return PipelineStatusWriteResult{}, err
	}
	if err := os.Chmod(temporaryPath, 0o600); err != nil {
		return PipelineStatusWriteResult{}, err
	}
	renameFile := w.RenameFile
	if renameFile == nil {
		renameFile = os.Rename
	}
	if err := renameFile(temporaryPath, w.StatusPath); err != nil {
		return PipelineStatusWriteResult{}, err
	}
	other := PeriodEvening
	if status.Period == PeriodEvening {
		other = PeriodMorning
	}
	ownNotification := own
	if ownNotification == nil {
		if notification, ok := recovered[status.Period]; ok {
			copy := notification
			ownNotification = &copy
		}
	}
	result := PipelineStatusWriteResult{}
	if ownNotification != nil {
		result.Notifications = append(result.Notifications, NotificationDelivery{Period: status.Period, Notification: *ownNotification})
	}
	if notification, ok := recovered[other]; ok {
		result.Notifications = append(result.Notifications, NotificationDelivery{Period: other, Notification: notification})
	}
	return result, nil
}

type statusReadResult struct {
	Document               PipelineStatusDocument
	RecoveredNotifications map[PipelinePeriod]NotificationAttempt
}

func (w *AtomicPipelineStatusWriter) readDocument(observedAt string) (statusReadResult, error) {
	data, err := os.ReadFile(w.StatusPath)
	if errors.Is(err, os.ErrNotExist) {
		return statusReadResult{Document: InitialDocument(), RecoveredNotifications: map[PipelinePeriod]NotificationAttempt{}}, nil
	}
	if err != nil {
		return statusReadResult{}, &PipelineStatusSchemaError{Message: fmt.Sprintf("cannot read pipeline status: %v", err)}
	}
	document, notifications, err := ParseDocument(data, observedAt)
	return statusReadResult{Document: document, RecoveredNotifications: notifications}, err
}

func ReadPipelineStatusDocument(statusPath string) (*PipelineStatusDocument, error) {
	data, err := os.ReadFile(statusPath)
	if errors.Is(err, os.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	document, _, err := ParseDocument(data, time.Now().UTC().Format(time.RFC3339Nano))
	if err != nil {
		return nil, err
	}
	return &document, nil
}

func InitialDocument() PipelineStatusDocument {
	return PipelineStatusDocument{
		SchemaVersion:      1,
		DefinitionsVersion: CurrentDefinitionsVersion,
		DefinitionsLabel:   CurrentDefinitionsLabel,
		UpdatedAt:          time.Unix(0, 0).UTC().Format(time.RFC3339Nano),
		Periods:            map[PipelinePeriod]PeriodStatus{PeriodMorning: InitialPeriod(), PeriodEvening: InitialPeriod()},
	}
}

func InitialPeriod() PeriodStatus {
	return PeriodStatus{Health: HealthStatus{State: "unobserved", Causes: []HealthCause{}}}
}

func RebaselineForDefinitions(document PipelineStatusDocument, changedAt string) PipelineStatusDocument {
	if document.DefinitionsVersion == CurrentDefinitionsVersion {
		return document
	}
	return PipelineStatusDocument{
		SchemaVersion:             1,
		DefinitionsVersion:        CurrentDefinitionsVersion,
		DefinitionsLabel:          CurrentDefinitionsLabel,
		UpdatedAt:                 document.UpdatedAt,
		Periods:                   map[PipelinePeriod]PeriodStatus{PeriodMorning: InitialPeriod(), PeriodEvening: InitialPeriod()},
		LastDefinitionsTransition: &DefinitionsTransition{FromVersion: document.DefinitionsVersion, ToVersion: CurrentDefinitionsVersion, ChangedAt: changedAt},
	}
}

func RecordActiveRun(document PipelineStatusDocument, status PipelineStatus, runID, updatedAt string) PipelineStatusDocument {
	period := document.Periods[status.Period]
	if period.ActiveRun != nil {
		period.LastInterruptedRun = &InterruptedRun{RunID: period.ActiveRun.RunID, StartedAt: period.ActiveRun.StartedAt, TargetDate: period.ActiveRun.TargetDate, ObservedAt: updatedAt}
	}
	period.ActiveRun = &ActiveRun{RunID: runID, StartedAt: status.StartedAt, TargetDate: status.TargetDate}
	return replacePeriod(document, status.Period, period, updatedAt)
}

type TerminalRecordResult struct {
	Document     PipelineStatusDocument
	Notification *NotificationAttempt
}

func RecordTerminal(document PipelineStatusDocument, status PipelineStatus, runID, updatedAt string) (TerminalRecordResult, error) {
	if !isPersistedPipelineOutcome(status.Outcome) {
		return TerminalRecordResult{}, &PipelineStatusSchemaError{Message: "unsupported terminal pipeline outcome " + status.Outcome}
	}
	if status.CompletedAt == nil || *status.CompletedAt == "" {
		return TerminalRecordResult{}, &PipelineStatusSchemaError{Message: "terminal pipeline status requires completedAt"}
	}
	if status.TargetDate == "" {
		return TerminalRecordResult{}, &PipelineStatusSchemaError{Message: "pipeline status requires targetDate"}
	}
	period := document.Periods[status.Period]
	noDataCount := period.ConsecutiveNoDataCount
	if status.Outcome == string(OutcomeCompletedNoData) {
		noDataCount++
	} else if status.Outcome == string(OutcomeCompletedTransferred) {
		noDataCount = 0
	}
	lastDoneAt := period.LastDoneAt
	if len(status.Outcome) >= len("completed:") && status.Outcome[:len("completed:")] == "completed:" {
		lastDoneAt = *status.CompletedAt
	}
	outcome := PersistedPipelineOutcome(status.Outcome)
	health := EvaluateHealth(outcome, status.V3, noDataCount, lastDoneAt, updatedAt, status.InputAnomalyCandidates)
	notification := StateTransitionTrigger(period.Health.State, health.State)
	var attempt *NotificationAttempt
	if notification != nil {
		notification.AttemptID = runID
		notification.ClaimedAt = updatedAt
		notification.Result = "claimed"
		attempt = notification
	}
	if isFailure(outcome) {
		period.ConsecutiveFailureCount++
	} else {
		period.ConsecutiveFailureCount = 0
	}
	period.ConsecutiveNoDataCount = noDataCount
	period.Health = health
	period.ActiveRun = nil
	period.LastTerminal = &TerminalObservation{RunID: runID, Outcome: outcome, StartedAt: status.StartedAt, CompletedAt: *status.CompletedAt, TargetDate: status.TargetDate, Counts: status.Counts, PartialInput: status.PartialInput, Diagnostic: status.Diagnostic, InputAnomalyCandidates: status.InputAnomalyCandidates, V3: status.V3}
	if lastDoneAt != "" && lastDoneAt != period.LastDoneAt {
		period.LastDoneAt = lastDoneAt
	}
	if outcome == OutcomeCompletedTransferred {
		period.LastTransferredAt = *status.CompletedAt
	}
	if attempt != nil {
		period.LastNotificationAttempt = attempt
	}
	return TerminalRecordResult{Document: replacePeriod(document, status.Period, period, updatedAt), Notification: attempt}, nil
}

func StateTransitionTrigger(fromState, toState string) *NotificationAttempt {
	if (fromState == "unobserved" || fromState == "normal") && toState == "alert" {
		return &NotificationAttempt{Trigger: "state-transition", FromState: fromState, ToState: toState}
	}
	if fromState == "alert" && toState == "normal" {
		return &NotificationAttempt{Trigger: "state-transition", FromState: fromState, ToState: toState}
	}
	return nil
}

func EvaluateHealth(outcome PersistedPipelineOutcome, v3 *V3Observation, consecutiveNoDataCount int, lastDoneAt, observedAt string, anomalies []scaleexporter.InputAnomalyCandidate) HealthStatus {
	causes := make([]HealthCause, 0, 5)
	if isFailure(outcome) {
		causes = append(causes, HealthCauseTerminalFailure)
	}
	if v3 != nil && v3.WindowedWeightCount >= 1 && v3.Transfer.State != TransferWritten {
		causes = append(causes, HealthCauseV3NotTransferred)
	}
	if lastDoneAt != "" {
		last, lastErr := time.Parse(time.RFC3339Nano, lastDoneAt)
		observed, observedErr := time.Parse(time.RFC3339Nano, observedAt)
		if lastErr == nil && observedErr == nil && observed.Sub(last) >= 48*time.Hour {
			causes = append(causes, HealthCauseV1Stale)
		}
	}
	if consecutiveNoDataCount >= 4 {
		causes = append(causes, HealthCauseConsecutiveNoData)
	}
	if len(anomalies) > 0 {
		causes = append(causes, HealthCauseInputAnomaly)
	}
	state := "normal"
	if len(causes) > 0 {
		state = "alert"
	}
	return HealthStatus{State: state, Causes: causes}
}

func ParseDocument(data []byte, observedAt string) (PipelineStatusDocument, map[PipelinePeriod]NotificationAttempt, error) {
	var raw map[string]json.RawMessage
	if err := json.Unmarshal(data, &raw); err != nil {
		return PipelineStatusDocument{}, nil, &PipelineStatusSchemaError{Message: "cannot read pipeline status: " + err.Error()}
	}
	if raw == nil {
		return PipelineStatusDocument{}, nil, &PipelineStatusSchemaError{Message: "pipeline status must be a JSON object"}
	}
	var document PipelineStatusDocument
	if err := json.Unmarshal(data, &document); err != nil {
		return PipelineStatusDocument{}, nil, &PipelineStatusSchemaError{Message: "cannot read pipeline status: " + err.Error()}
	}
	if document.SchemaVersion != 1 {
		return PipelineStatusDocument{}, nil, &PipelineStatusSchemaError{Message: fmt.Sprintf("unsupported status schema version %d", document.SchemaVersion)}
	}
	if document.DefinitionsVersion < 1 {
		return PipelineStatusDocument{}, nil, &PipelineStatusSchemaError{Message: fmt.Sprintf("unsupported status definitions version %d", document.DefinitionsVersion)}
	}
	if document.DefinitionsVersion > CurrentDefinitionsVersion {
		return PipelineStatusDocument{}, nil, &PipelineStatusSchemaError{Message: fmt.Sprintf("status definitions version %d is newer than this build", document.DefinitionsVersion)}
	}
	if _, ok := raw["definitionsLabel"]; !ok || document.DefinitionsLabel == "" {
		return PipelineStatusDocument{}, nil, &PipelineStatusSchemaError{Message: "pipeline status definitionsLabel must be a string"}
	}
	periodsRaw, ok := raw["periods"]
	if !ok {
		return PipelineStatusDocument{}, nil, &PipelineStatusSchemaError{Message: "pipeline status has an invalid period state"}
	}
	var periodMap map[string]json.RawMessage
	if err := json.Unmarshal(periodsRaw, &periodMap); err != nil {
		return PipelineStatusDocument{}, nil, &PipelineStatusSchemaError{Message: "pipeline status has an invalid period state"}
	}
	recovered := make(map[PipelinePeriod]NotificationAttempt)
	parsedPeriods := make(map[PipelinePeriod]PeriodStatus)
	for _, period := range []PipelinePeriod{PeriodMorning, PeriodEvening} {
		periodData, exists := periodMap[string(period)]
		if !exists {
			return PipelineStatusDocument{}, nil, &PipelineStatusSchemaError{Message: "pipeline status has an invalid period state"}
		}
		parsed, notification, err := parsePeriodState(periodData, observedAt)
		if err != nil {
			return PipelineStatusDocument{}, nil, err
		}
		parsedPeriods[period] = parsed
		if notification != nil {
			recovered[period] = *notification
		}
	}
	document.Periods = parsedPeriods
	return document, recovered, nil
}

func parsePeriodState(data []byte, observedAt string) (PeriodStatus, *NotificationAttempt, error) {
	var raw map[string]json.RawMessage
	if err := json.Unmarshal(data, &raw); err != nil || raw == nil {
		return PeriodStatus{}, nil, &PipelineStatusSchemaError{Message: "pipeline status has an invalid period state"}
	}
	var period PeriodStatus
	if err := json.Unmarshal(data, &period); err != nil || period.ConsecutiveFailureCount < 0 || period.ConsecutiveNoDataCount < 0 {
		return PeriodStatus{}, nil, &PipelineStatusSchemaError{Message: "pipeline status has an invalid period state"}
	}
	if healthData, hasHealth := raw["health"]; hasHealth {
		var health HealthStatus
		if err := json.Unmarshal(healthData, &health); err != nil || (health.State != "unobserved" && health.State != "normal" && health.State != "alert") || health.Causes == nil {
			return PeriodStatus{}, nil, &PipelineStatusSchemaError{Message: "pipeline status has an invalid period state"}
		}
		period.Health = health
		return period, nil, nil
	}
	if period.LastTerminal == nil || !isTerminalObservation(period.LastTerminal) {
		return PeriodStatus{}, nil, &PipelineStatusSchemaError{Message: "pipeline status has an invalid period state"}
	}
	health := EvaluateHealth(period.LastTerminal.Outcome, period.LastTerminal.V3, period.ConsecutiveNoDataCount, period.LastDoneAt, observedAt, period.LastTerminal.InputAnomalyCandidates)
	period.Health = health
	period.LastNotificationDiagnostic = &NotificationDiagnostic{Code: "notification-state-missing", ObservedAt: observedAt, LastTerminalRunID: period.LastTerminal.RunID}
	if health.State != "alert" {
		return period, nil, nil
	}
	notification := NotificationAttempt{Trigger: "notification-state-loss", ToState: "alert", AttemptID: "notification-state-loss:" + period.LastTerminal.RunID, ClaimedAt: observedAt, Result: "claimed"}
	period.LastNotificationAttempt = &notification
	return period, &notification, nil
}

func isTerminalObservation(observation *TerminalObservation) bool {
	if observation == nil || observation.RunID == "" || observation.StartedAt == "" || observation.CompletedAt == "" || observation.TargetDate == "" {
		return false
	}
	return isPersistedPipelineOutcome(string(observation.Outcome))
}

func isFailure(outcome PersistedPipelineOutcome) bool {
	return len(string(outcome)) >= 7 && string(outcome)[:7] == "failed:"
}

func isPersistedPipelineOutcome(value string) bool {
	switch PersistedPipelineOutcome(value) {
	case OutcomeCompletedNoData, OutcomeCompletedTransferred, OutcomeFailedInputMissing, OutcomeFailedInputUnstable, OutcomeFailedInputInvalid, OutcomeFailedTransfer:
		return true
	default:
		return false
	}
}

func replacePeriod(document PipelineStatusDocument, period PipelinePeriod, next PeriodStatus, updatedAt string) PipelineStatusDocument {
	periods := make(map[PipelinePeriod]PeriodStatus, len(document.Periods))
	for key, value := range document.Periods {
		periods[key] = value
	}
	periods[period] = next
	document.Periods = periods
	document.UpdatedAt = updatedAt
	return document
}
