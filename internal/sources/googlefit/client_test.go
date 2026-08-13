package googlefit

import (
	"testing"

	"github.com/kappaseijin/scale2sheet4go/internal/domain"
)

func TestReadingFromPoint(t *testing.T) {
	fp := 68.4
	point := Point{
		StartTimeNanos:     1_750_233_600_000_000_000,
		EndTimeNanos:       1_750_233_660_000_000_000,
		Values:             []Value{{FPVal: &fp}},
		OriginDataSourceID: "raw:scale",
	}
	reading, ok := ReadingFromPoint(point, domain.KindWeight, domain.UnitKg, 0)
	if !ok {
		t.Fatal("ReadingFromPoint() returned ok=false")
	}
	if reading.Value != fp || reading.Unit != domain.UnitKg || reading.Source != "google_fit" {
		t.Fatalf("reading = %#v", reading)
	}
	if reading.SourceRecordID != point.OriginDataSourceID {
		t.Fatalf("source record id = %q, want %q", reading.SourceRecordID, point.OriginDataSourceID)
	}
	if reading.MeasuredAt == "" {
		t.Fatal("MeasuredAt is empty")
	}
}

func TestReadingFromPointUsesIntegerValueAndRejectsMissingValues(t *testing.T) {
	integer := int64(64)
	reading, ok := ReadingFromPoint(Point{
		StartTimeNanos: 1_750_233_600_000_000_000,
		Values:         []Value{{IntVal: &integer}},
	}, domain.KindPulse, domain.UnitBPM, 0)
	if !ok || reading.Value != 64 {
		t.Fatalf("integer reading = %#v, ok=%v", reading, ok)
	}
	if _, ok := ReadingFromPoint(Point{}, domain.KindPulse, domain.UnitBPM, 0); ok {
		t.Fatal("missing point value returned ok=true")
	}
}
