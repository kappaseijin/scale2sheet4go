package service

import (
	"context"
	"testing"
	"time"

	"github.com/kappaseijin/scale2sheet4go/internal/config"
	"github.com/kappaseijin/scale2sheet4go/internal/domain"
	"github.com/kappaseijin/scale2sheet4go/internal/sheets"
)

func TestToSpreadsheetRowFormatsCapturedAtInConfiguredTimezone(t *testing.T) {
	weight := 70.2
	set := domain.LatestMeasurementSet{
		Period:        domain.PeriodMorning,
		CapturedAt:    "2026-06-17T21:50:00.000Z",
		Source:        "apple_health_export",
		WeightKg:      &weight,
		SourcesByKind: map[domain.MeasurementKind]string{},
	}
	row, err := ToSpreadsheetRow(set, time.FixedZone("JST", 9*60*60))
	if err != nil {
		t.Fatal(err)
	}
	if row.Date != "2026-06-18" || row.Time != "06:50" || row.PeriodLabel != "朝" || row.WeightKg != 70.2 {
		t.Fatalf("row = %#v", row)
	}
}

func TestTransferLatestMeasurementSetReturnsRowOnlyForWrittenCell(t *testing.T) {
	weight := 70.2
	set := domain.LatestMeasurementSet{
		Period:        domain.PeriodMorning,
		CapturedAt:    "2026-08-11T00:00:00.000Z",
		Source:        "scale_exporter",
		WeightKg:      &weight,
		SourcesByKind: map[domain.MeasurementKind]string{},
	}
	updated := 1
	client := &transferClient{updatedCells: &updated}
	result, err := TransferLatestMeasurementSet(context.Background(), client, set, config.GoogleSheetsAuthConfig{
		SpreadsheetID: "sheet",
		SheetName:     "測定値",
	}, time.FixedZone("JST", 9*60*60))
	if err != nil {
		t.Fatal(err)
	}
	if result.Row == nil || result.Outcome.State != sheets.TransferWritten {
		t.Fatalf("result = %#v", result)
	}
}

type transferClient struct {
	updatedCells *int
}

func (c *transferClient) Get(context.Context, string, string) ([][]any, error) {
	return [][]any{{"月日", "朝体重"}, {"2026-08-11"}}, nil
}

func (c *transferClient) BatchUpdate(context.Context, string, []sheets.ValueRange) (*int, error) {
	return c.updatedCells, nil
}
