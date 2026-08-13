package pipeline

import (
	"context"
	"testing"
	"time"

	"github.com/kappaseijin/scale2sheet4go/internal/domain"
)

type statusWriterSpy struct {
	statuses []PipelineStatus
}

func (s *statusWriterSpy) Write(status PipelineStatus) (PipelineStatusWriteResult, error) {
	s.statuses = append(s.statuses, status)
	return PipelineStatusWriteResult{}, nil
}

func TestRunCompletesNoDataWithoutTransfer(t *testing.T) {
	writer := &statusWriterSpy{}
	transferCalled := false
	result, err := Run(context.Background(), RunOptions{
		Period:        domain.PeriodMorning,
		ReferenceTime: time.Date(2026, 6, 18, 7, 0, 0, 0, time.FixedZone("JST", 9*60*60)),
		TimeZone:      time.FixedZone("JST", 9*60*60),
		TargetDate:    "2026-06-18",
		ReadInput: func() (StableInputSnapshot, error) {
			return StableInputSnapshot{MatchedFileCount: 1, ReadLineCount: 1, Readings: []domain.MeasurementReading{{Kind: domain.KindPulse, Value: 60, Unit: domain.UnitBPM, MeasuredAt: "2026-06-17T22:00:00Z", Source: "test"}}}, nil
		},
		Transfer: func([]domain.MeasurementReading) (domain.TransferOutcome, error) {
			transferCalled = true
			return domain.TransferOutcome{}, nil
		},
		StatusWriter: writer,
	})
	if err != nil || result.ExitCode != 0 || result.Outcome != "completed:no-data" {
		t.Fatalf("result, err = %#v, %v", result, err)
	}
	if transferCalled || len(writer.statuses) != 2 || writer.statuses[1].Outcome != "completed:no-data" {
		t.Fatalf("transfer=%v statuses=%#v", transferCalled, writer.statuses)
	}
}

func TestRunTransfersWeightAndRejectsUnconfirmedWrite(t *testing.T) {
	writer := &statusWriterSpy{}
	transferCalls := 0
	result, err := Run(context.Background(), RunOptions{
		Period:        domain.PeriodMorning,
		ReferenceTime: time.Date(2026, 6, 18, 7, 0, 0, 0, time.FixedZone("JST", 9*60*60)),
		TimeZone:      time.FixedZone("JST", 9*60*60),
		TargetDate:    "2026-06-18",
		ReadInput: func() (StableInputSnapshot, error) {
			return StableInputSnapshot{MatchedFileCount: 1, ReadLineCount: 1, Readings: []domain.MeasurementReading{{Kind: domain.KindWeight, Value: 70, Unit: domain.UnitKg, MeasuredAt: "2026-06-17T22:00:00Z", Source: "test"}}}, nil
		},
		Transfer: func(readings []domain.MeasurementReading) (domain.TransferOutcome, error) {
			transferCalls++
			if len(readings) != 1 {
				t.Fatalf("transfer readings = %#v", readings)
			}
			return domain.TransferOutcome{State: domain.TransferUnknown}, nil
		},
		StatusWriter: writer,
	})
	if err != nil || result.ExitCode != 1 || result.Outcome != "failed:transfer" || transferCalls != 1 {
		t.Fatalf("result, err, calls = %#v, %v, %d", result, err, transferCalls)
	}
	if writer.statuses[len(writer.statuses)-1].V3 == nil || writer.statuses[len(writer.statuses)-1].V3.Transfer.State != "unknown" {
		t.Fatalf("terminal status = %#v", writer.statuses[len(writer.statuses)-1])
	}
}
