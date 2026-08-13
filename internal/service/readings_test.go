package service

import (
	"testing"
	"time"

	"github.com/kappaseijin/scale2sheet4go/internal/domain"
)

func TestFilterReadingsByPeriodWindowUsesConfiguredTimezoneAndInclusiveBounds(t *testing.T) {
	location := time.FixedZone("JST", 9*60*60)
	readings := []domain.MeasurementReading{
		{Kind: domain.KindWeight, MeasuredAt: "2026-06-17T19:59:00Z", Value: 1}, // 04:59 JST
		{Kind: domain.KindWeight, MeasuredAt: "2026-06-17T20:00:00Z", Value: 2}, // 05:00 JST
		{Kind: domain.KindWeight, MeasuredAt: "2026-06-18T03:00:00Z", Value: 3}, // 12:00 JST
		{Kind: domain.KindWeight, MeasuredAt: "2026-06-18T03:01:00Z", Value: 4}, // 12:01 JST
	}
	got := FilterReadingsByPeriodWindow(readings, domain.PeriodMorning, time.Date(2026, 6, 18, 12, 0, 0, 0, location), location)
	if len(got) != 2 || got[0].Value != 2 || got[1].Value != 3 {
		t.Fatalf("morning window = %#v, want values 2 and 3", got)
	}
}

func TestCountMeasurementsDeduplicatesExactThenCrossSource(t *testing.T) {
	readings := []domain.MeasurementReading{
		{Kind: domain.KindWeight, Value: 70, MeasuredAt: "2026-06-18T00:00:00Z", Source: "a"},
		{Kind: domain.KindWeight, Value: 70, MeasuredAt: "2026-06-18T00:00:00Z", Source: "a"},
		{Kind: domain.KindWeight, Value: 70.00001, MeasuredAt: "2026-06-18T00:00:00Z", Source: "b"},
		{Kind: domain.KindPulse, Value: 60, MeasuredAt: "2026-06-18T00:00:00Z", Source: "a"},
	}
	counts := CountMeasurements(readings)
	if counts.WindowedReadingCount != 3 || counts.UniqueMeasurementCount != 2 {
		t.Fatalf("counts = %#v, want published=3 unique=2", counts)
	}
}
