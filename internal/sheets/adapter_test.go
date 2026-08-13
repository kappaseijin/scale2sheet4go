package sheets

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/kappaseijin/scale2sheet4go/internal/config"
	"github.com/kappaseijin/scale2sheet4go/internal/domain"
)

type fakeClient struct {
	getValues    [][][]any
	getRanges    []string
	batchData    []ValueRange
	updatedCells *int
	getBlock     bool
	dateGetBlock bool
	batchBlock   bool
	getCallCount int
}

func (f *fakeClient) Get(ctx context.Context, spreadsheetID, readRange string) ([][]any, error) {
	f.getRanges = append(f.getRanges, spreadsheetID+":"+readRange)
	f.getCallCount++
	block := f.getBlock || (f.getCallCount == 2 && f.dateGetBlock)
	if block {
		<-ctx.Done()
		return nil, ctx.Err()
	}
	if len(f.getValues) == 0 {
		return nil, nil
	}
	values := f.getValues[0]
	f.getValues = f.getValues[1:]
	return values, nil
}

func (f *fakeClient) BatchUpdate(ctx context.Context, spreadsheetID string, data []ValueRange) (*int, error) {
	if f.batchBlock {
		<-ctx.Done()
		return nil, ctx.Err()
	}
	f.batchData = append([]ValueRange(nil), data...)
	return f.updatedCells, nil
}

func latestSet() domain.LatestMeasurementSet {
	weight := 70.2
	return domain.LatestMeasurementSet{
		Period:        domain.PeriodMorning,
		CapturedAt:    "2026-08-11T00:00:00.000Z",
		Source:        "scale_exporter",
		WeightKg:      &weight,
		SourcesByKind: map[domain.MeasurementKind]string{},
	}
}

func TestBuildSheetColumnMapping(t *testing.T) {
	mapping, err := BuildSheetColumnMapping([]any{
		"月日", "朝体重", "朝体温", "朝血圧上", "朝血圧下", "朝脈拍",
		"夜体重", "夜体温", "夜血圧(上)", "夜血圧(下)", "夜脈拍",
	})
	if err != nil {
		t.Fatal(err)
	}
	if mapping.DateColumnIndex != 0 {
		t.Fatalf("date column = %d, want 0", mapping.DateColumnIndex)
	}
	wantMorning := map[SheetMeasurementField]int{
		SheetFieldWeight: 1, SheetFieldTemperature: 2, SheetFieldSystolicBP: 3,
		SheetFieldDiastolicBP: 4, SheetFieldHeartRate: 5,
	}
	for field, want := range wantMorning {
		if got := mapping.Periods[domain.PeriodMorning][field]; got != want {
			t.Errorf("morning %s column = %d, want %d", field, got, want)
		}
	}
	if got := mapping.Periods[domain.PeriodEvening][SheetFieldSystolicBP]; got != 8 {
		t.Errorf("evening systolic column = %d, want 8", got)
	}
}

func TestBuildSheetColumnMappingRequiresDateHeader(t *testing.T) {
	if _, err := BuildSheetColumnMapping([]any{"朝体重"}); err == nil {
		t.Fatal("BuildSheetColumnMapping() unexpectedly succeeded")
	}
}

func TestBuildSheetColumnMappingTrimsPeriodPrefixByRune(t *testing.T) {
	mapping, err := BuildSheetColumnMapping([]any{"月日", "朝 体重", "夜 体温"})
	if err != nil {
		t.Fatal(err)
	}
	if got := mapping.Periods[domain.PeriodMorning][SheetFieldWeight]; got != 1 {
		t.Fatalf("morning weight column = %d, want 1", got)
	}
	if got := mapping.Periods[domain.PeriodEvening][SheetFieldTemperature]; got != 2 {
		t.Fatalf("evening temperature column = %d, want 2", got)
	}
}

func TestFindTodayRowNumberSupportsDateFormats(t *testing.T) {
	location := time.FixedZone("JST", 9*60*60)
	target := time.Date(2026, 6, 18, 7, 0, 0, 0, location)
	for _, test := range []struct {
		name string
		rows [][]any
		want int
	}{
		{name: "iso", rows: [][]any{{"月日"}, {"2026-06-17"}, {"6/18"}}, want: 3},
		{name: "slash", rows: [][]any{{"月日"}, {"2026/06/18"}}, want: 2},
		{name: "japanese", rows: [][]any{{"月日"}, {"6月18日"}}, want: 2},
	} {
		t.Run(test.name, func(t *testing.T) {
			got, ok := FindTodayRowNumber(test.rows, target)
			if !ok || got != test.want {
				t.Fatalf("FindTodayRowNumber() = %d, %v; want %d, true", got, ok, test.want)
			}
		})
	}
}

func TestBuildMeasurementUpdateDataUsesDefinedValuesOnly(t *testing.T) {
	weight := 70.2
	systolic := 120.0
	pulse := 65.0
	set := latestSet()
	set.Period = domain.PeriodEvening
	set.WeightKg = &weight
	set.BloodPressureSystolicMmHg = &systolic
	set.PulseBpm = &pulse
	mapping, err := BuildSheetColumnMapping([]any{
		"月日", "朝体重", "夜体重", "夜体温", "夜血圧上", "夜血圧下", "夜脈拍",
	})
	if err != nil {
		t.Fatal(err)
	}
	got := BuildMeasurementUpdateData("体温・血圧", 12, set, mapping)
	want := []ValueRange{
		{Range: "'体温・血圧'!C12", Values: [][]any{{70.2}}},
		{Range: "'体温・血圧'!E12", Values: [][]any{{120.0}}},
		{Range: "'体温・血圧'!G12", Values: [][]any{{65.0}}},
	}
	if len(got) != len(want) {
		t.Fatalf("BuildMeasurementUpdateData() length = %d, want %d", len(got), len(want))
	}
	for i := range want {
		if got[i].Range != want[i].Range || got[i].Values[0][0] != want[i].Values[0][0] {
			t.Errorf("data[%d] = %#v, want %#v", i, got[i], want[i])
		}
	}
}

func TestColumnIndexToA1(t *testing.T) {
	for index, want := range map[int]string{0: "A", 25: "Z", 26: "AA"} {
		if got, err := ColumnIndexToA1(index); err != nil || got != want {
			t.Errorf("ColumnIndexToA1(%d) = %q, %v; want %q", index, got, err, want)
		}
	}
	if _, err := ColumnIndexToA1(-1); err == nil {
		t.Fatal("ColumnIndexToA1(-1) unexpectedly succeeded")
	}
}

func TestUpdateSpreadsheetMeasurementsWritesAndUsesRanges(t *testing.T) {
	updated := 1
	client := &fakeClient{
		getValues:    [][][]any{{{"月日", "朝体重"}}, {{"月日"}, {"2026-08-11"}}},
		updatedCells: &updated,
	}
	outcome, err := UpdateSpreadsheetMeasurements(context.Background(), client, UpdateInput{
		Config:    config.GoogleSheetsAuthConfig{SpreadsheetID: "sheet", SheetName: "測定値"},
		LatestSet: latestSet(),
		TimeZone:  time.FixedZone("JST", 9*60*60),
	})
	if err != nil {
		t.Fatal(err)
	}
	if outcome.State != TransferWritten || outcome.TransferredCellCount == nil || *outcome.TransferredCellCount != 1 {
		t.Fatalf("outcome = %#v", outcome)
	}
	if len(client.batchData) != 1 || client.batchData[0].Range != "'測定値'!B2" {
		t.Fatalf("batch data = %#v", client.batchData)
	}
}

func TestUpdateSpreadsheetMeasurementsReturnsUnknownWhenCountMissing(t *testing.T) {
	client := &fakeClient{
		getValues:    [][][]any{{{"月日", "朝体重"}}, {{"月日"}, {"2026-08-11"}}},
		updatedCells: nil,
	}
	outcome, err := UpdateSpreadsheetMeasurements(context.Background(), client, UpdateInput{
		Config:    config.GoogleSheetsAuthConfig{SpreadsheetID: "sheet", SheetName: "測定値"},
		LatestSet: latestSet(),
		TimeZone:  time.FixedZone("JST", 9*60*60),
	})
	if err != nil {
		t.Fatal(err)
	}
	if outcome.State != TransferUnknown || outcome.TransferredCellCount != nil {
		t.Fatalf("outcome = %#v", outcome)
	}
}

func TestUpdateSpreadsheetMeasurementsTimesOutAtDateRead(t *testing.T) {
	client := &fakeClient{
		getValues:    [][][]any{{{"月日", "朝体重"}}},
		dateGetBlock: true,
	}
	_, err := UpdateSpreadsheetMeasurements(context.Background(), client, UpdateInput{
		Config:    config.GoogleSheetsAuthConfig{SpreadsheetID: "sheet", SheetName: "測定値"},
		LatestSet: latestSet(),
		TimeZone:  time.FixedZone("JST", 9*60*60),
		Deadline:  10 * time.Millisecond,
	})
	var timeoutErr *OperationTimeoutError
	if !errors.As(err, &timeoutErr) {
		t.Fatalf("error = %v, want OperationTimeoutError", err)
	}
	if timeoutErr.Stage != StageDateColumnRead || timeoutErr.WriteConfirmation != WriteNotAttempted {
		t.Fatalf("timeout = %#v", timeoutErr)
	}
}

func TestQuoteSheetNameEscapesApostrophes(t *testing.T) {
	if got := QuoteSheetName("Bob's data"); got != "'Bob''s data'" {
		t.Fatalf("QuoteSheetName() = %q", got)
	}
}

func TestUpdateSpreadsheetMeasurementsDoesNotBatchWhenNoRow(t *testing.T) {
	updated := 1
	client := &fakeClient{
		getValues:    [][][]any{{{"月日", "朝体重"}}, {{"月日"}, {"2026-08-10"}}},
		updatedCells: &updated,
	}
	outcome, err := UpdateSpreadsheetMeasurements(context.Background(), client, UpdateInput{
		Config:    config.GoogleSheetsAuthConfig{SpreadsheetID: "sheet", SheetName: "測定値"},
		LatestSet: latestSet(),
		TimeZone:  time.FixedZone("JST", 9*60*60),
	})
	if err != nil {
		t.Fatal(err)
	}
	if outcome.State != TransferNotWritten || outcome.TransferredCellCount == nil || *outcome.TransferredCellCount != 0 {
		t.Fatalf("outcome = %#v", outcome)
	}
	if len(client.batchData) != 0 || strings.Contains(strings.Join(client.getRanges, "\n"), "batch") {
		t.Fatalf("unexpected writes: ranges=%v batch=%#v", client.getRanges, client.batchData)
	}
}
