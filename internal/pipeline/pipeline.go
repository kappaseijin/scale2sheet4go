package pipeline

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/kappaseijin/scale2sheet4go/internal/domain"
	"github.com/kappaseijin/scale2sheet4go/internal/service"
	"github.com/kappaseijin/scale2sheet4go/internal/sources/scaleexporter"
)

type PipelineResult struct {
	ExitCode int
	Outcome  string
}

type Notifier interface {
	Notify(period PipelinePeriod, fromState, toState, reason string) error
}

type RunOptions struct {
	Period        domain.MeasurementPeriod
	ReferenceTime time.Time
	TimeZone      *time.Location
	TargetDate    string
	ReadInput     func() (StableInputSnapshot, error)
	Transfer      func([]domain.MeasurementReading) (domain.TransferOutcome, error)
	StatusWriter  PipelineStatusWriter
	Notifier      Notifier
	Now           func() time.Time
}

func Run(ctx context.Context, options RunOptions) (PipelineResult, error) {
	if ctx == nil {
		ctx = context.Background()
	}
	if err := ctx.Err(); err != nil {
		return PipelineResult{}, err
	}
	period, err := pipelinePeriod(options.Period)
	if err != nil {
		return PipelineResult{}, err
	}
	if options.ReadInput == nil {
		return PipelineResult{}, errors.New("pipeline input reader is required")
	}
	if options.ReferenceTime.IsZero() {
		options.ReferenceTime = time.Now()
	}
	if options.TimeZone == nil {
		options.TimeZone = time.UTC
	}
	if options.TargetDate == "" {
		options.TargetDate = options.ReferenceTime.In(options.TimeZone).Format("2006-01-02")
	}
	now := options.Now
	if now == nil {
		now = time.Now
	}
	startedAt := now().UTC().Format(time.RFC3339Nano)

	writeStatus := func(outcome string, counts PipelineCounts, completed bool, diagnostic string, partialInput bool, anomalies []scaleexporter.InputAnomalyCandidate, v3 *V3Observation) error {
		if options.StatusWriter == nil {
			return nil
		}
		var completedAt *string
		if completed {
			value := now().UTC().Format(time.RFC3339Nano)
			completedAt = &value
		}
		result, err := options.StatusWriter.Write(PipelineStatus{
			Period:                 period,
			Outcome:                outcome,
			StartedAt:              startedAt,
			CompletedAt:            completedAt,
			TargetDate:             options.TargetDate,
			Counts:                 counts,
			PartialInput:           partialInput,
			Diagnostic:             diagnostic,
			InputAnomalyCandidates: anomalies,
			V3:                     v3,
		})
		if err != nil {
			return err
		}
		if completed && options.Notifier != nil {
			for _, delivery := range result.Notifications {
				fromState := delivery.Notification.FromState
				if delivery.Notification.Trigger == "notification-state-loss" {
					fromState = "unobserved"
				}
				if err := options.Notifier.Notify(delivery.Period, fromState, delivery.Notification.ToState, delivery.Notification.Reason); err != nil {
					return err
				}
			}
		}
		return nil
	}

	if err := writeStatus("running", PipelineCounts{}, false, "", false, nil, nil); err != nil {
		return PipelineResult{}, err
	}
	if err := ctx.Err(); err != nil {
		return PipelineResult{}, err
	}

	input, err := options.ReadInput()
	if err != nil {
		var inputErr *InputSnapshotError
		if errors.As(err, &inputErr) {
			outcome := "failed:" + inputErr.Outcome
			if writeErr := writeStatus(outcome, InputPipelineCounts(inputErr.Counts.MatchedFileCount, inputErr.Counts.ReadLineCount), true, inputErr.Diagnostic, inputErr.Outcome == "input-invalid-or-partial", inputErr.InputAnomalyCandidates, &V3Observation{
				Input:    "unavailable",
				Transfer: V3TransferObservation{State: TransferNotAttempted},
			}); writeErr != nil {
				return PipelineResult{}, writeErr
			}
			return PipelineResult{ExitCode: 1, Outcome: outcome}, nil
		}
		return PipelineResult{}, err
	}

	windowed := service.FilterReadingsByPeriodWindow(input.Readings, options.Period, options.ReferenceTime, options.TimeZone)
	exact := service.DeduplicateExactReadings(windowed)
	unique := service.DeduplicateCrossSourceReadings(exact)
	measurementCounts := service.CountMeasurements(windowed)
	counts := AllPipelineCounts(input.MatchedFileCount, input.ReadLineCount, measurementCounts.WindowedReadingCount, measurementCounts.UniqueMeasurementCount)
	windowedWeightCount := 0
	for _, reading := range unique {
		if reading.Kind == domain.KindWeight {
			windowedWeightCount++
		}
	}
	if windowedWeightCount == 0 {
		v3 := &V3Observation{Input: "ready", WindowedWeightCount: 0, Transfer: V3TransferObservation{State: TransferNotAttempted}}
		if err := writeStatus(string(OutcomeCompletedNoData), counts, true, "", false, input.InputAnomalyCandidates, v3); err != nil {
			return PipelineResult{}, err
		}
		return PipelineResult{ExitCode: 0, Outcome: string(OutcomeCompletedNoData)}, nil
	}
	if options.Transfer == nil {
		return PipelineResult{}, errors.New("pipeline transfer function is required")
	}
	if err := ctx.Err(); err != nil {
		return PipelineResult{}, err
	}

	transferOutcome, err := options.Transfer(unique)
	if err != nil {
		v3 := &V3Observation{Input: "ready", WindowedWeightCount: windowedWeightCount, Transfer: V3TransferObservation{State: TransferFailed}}
		if writeErr := writeStatus(string(OutcomeFailedTransfer), counts, true, err.Error(), false, input.InputAnomalyCandidates, v3); writeErr != nil {
			return PipelineResult{}, writeErr
		}
		return PipelineResult{ExitCode: 1, Outcome: string(OutcomeFailedTransfer)}, nil
	}
	v3 := &V3Observation{
		Input:               "ready",
		WindowedWeightCount: windowedWeightCount,
		Transfer: V3TransferObservation{
			State:                transferState(transferOutcome.State),
			TransferredCellCount: transferOutcome.TransferredCellCount,
		},
	}
	if transferOutcome.State != domain.TransferWritten || transferOutcome.TransferredCellCount == nil || *transferOutcome.TransferredCellCount < 1 {
		diagnostic := fmt.Sprintf("transfer reported %s with %s cell(s) updated", transferOutcome.State, transferredCount(transferOutcome.TransferredCellCount))
		if err := writeStatus(string(OutcomeFailedTransfer), counts, true, diagnostic, false, input.InputAnomalyCandidates, v3); err != nil {
			return PipelineResult{}, err
		}
		return PipelineResult{ExitCode: 1, Outcome: string(OutcomeFailedTransfer)}, nil
	}
	if err := writeStatus(string(OutcomeCompletedTransferred), counts, true, "", false, input.InputAnomalyCandidates, v3); err != nil {
		return PipelineResult{}, err
	}
	return PipelineResult{ExitCode: 0, Outcome: string(OutcomeCompletedTransferred)}, nil
}

func pipelinePeriod(period domain.MeasurementPeriod) (PipelinePeriod, error) {
	switch period {
	case domain.PeriodMorning:
		return PeriodMorning, nil
	case domain.PeriodEvening:
		return PeriodEvening, nil
	default:
		return "", fmt.Errorf("unsupported measurement period %q", period)
	}
}

func transferState(state domain.TransferOutcomeState) V3TransferState {
	switch state {
	case domain.TransferWritten:
		return TransferWritten
	case domain.TransferNotWritten:
		return TransferNotWritten
	default:
		return TransferUnknown
	}
}

func transferredCount(value *int) string {
	if value == nil {
		return "unknown"
	}
	return fmt.Sprintf("%d", *value)
}
