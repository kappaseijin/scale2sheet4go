package service

import (
	"context"
	"fmt"
	"time"

	"github.com/kappaseijin/scale2sheet4go/internal/config"
	"github.com/kappaseijin/scale2sheet4go/internal/domain"
	"github.com/kappaseijin/scale2sheet4go/internal/sheets"
)

type TransferLatestMeasurementSetResult struct {
	Row     *domain.SpreadsheetRow
	Outcome domain.TransferOutcome
}

func TransferLatestMeasurementSet(
	ctx context.Context,
	client sheets.Client,
	latestSet domain.LatestMeasurementSet,
	sheetsConfig config.GoogleSheetsAuthConfig,
	timeZone *time.Location,
) (TransferLatestMeasurementSetResult, error) {
	outcome, err := sheets.UpdateSpreadsheetMeasurements(ctx, client, sheets.UpdateInput{
		Config:    sheetsConfig,
		LatestSet: latestSet,
		TimeZone:  timeZone,
	})
	if err != nil {
		return TransferLatestMeasurementSetResult{}, err
	}
	result := TransferLatestMeasurementSetResult{Outcome: outcome}
	if outcome.State == domain.TransferWritten && outcome.TransferredCellCount != nil && *outcome.TransferredCellCount >= 1 {
		row, err := ToSpreadsheetRow(latestSet, timeZone)
		if err != nil {
			return TransferLatestMeasurementSetResult{}, err
		}
		result.Row = &row
	}
	return result, nil
}

func ToSpreadsheetRow(latestSet domain.LatestMeasurementSet, timeZone *time.Location) (domain.SpreadsheetRow, error) {
	capturedAt, err := time.Parse(time.RFC3339Nano, latestSet.CapturedAt)
	if err != nil {
		return domain.SpreadsheetRow{}, fmt.Errorf("invalid capturedAt %q: %w", latestSet.CapturedAt, err)
	}
	if timeZone == nil {
		timeZone = time.UTC
	}
	capturedAt = capturedAt.In(timeZone)
	return domain.SpreadsheetRow{
		Date:                       capturedAt.Format("2006-01-02"),
		Time:                       capturedAt.Format("15:04"),
		PeriodLabel:                domain.PeriodLabels[latestSet.Period],
		WeightKg:                   optionalNumber(latestSet.WeightKg),
		BodyTemperatureCelsius:     optionalNumber(latestSet.BodyTemperatureCelsius),
		BloodPressureSystolicMmHg:  optionalNumber(latestSet.BloodPressureSystolicMmHg),
		BloodPressureDiastolicMmHg: optionalNumber(latestSet.BloodPressureDiastolicMmHg),
		PulseBpm:                   optionalNumber(latestSet.PulseBpm),
		Source:                     latestSet.Source,
	}, nil
}

func optionalNumber(value *float64) any {
	if value == nil {
		return ""
	}
	return *value
}
