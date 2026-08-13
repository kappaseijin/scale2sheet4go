package domain

import "testing"

func TestMeasurementDomainContract(t *testing.T) {
	t.Run("period labels", func(t *testing.T) {
		if got, want := PeriodLabels[PeriodMorning], "朝"; got != want {
			t.Fatalf("morning label = %q, want %q", got, want)
		}
		if got, want := PeriodLabels[PeriodEvening], "夜"; got != want {
			t.Fatalf("evening label = %q, want %q", got, want)
		}
	})

	readings := []MeasurementReading{
		{Kind: KindWeight, Value: 70.1, Unit: UnitKg, MeasuredAt: "2026-06-18T07:00:00.000Z", Source: "apple_health_export"},
		{Kind: KindWeight, Value: 70.3, Unit: UnitKg, MeasuredAt: "2026-06-18T07:05:00.000Z", Source: "apple_health_export"},
		{Kind: KindPulse, Value: 64, Unit: UnitBPM, MeasuredAt: "2026-06-18T07:03:00.000Z", Source: "apple_health_export"},
	}

	t.Run("latest by kind", func(t *testing.T) {
		latest := LatestByKind(readings)
		if got := latest[KindWeight].Value; got != 70.3 {
			t.Fatalf("latest weight = %v, want 70.3", got)
		}
		if got := latest[KindPulse].Value; got != 64 {
			t.Fatalf("latest pulse = %v, want 64", got)
		}
	})

	t.Run("weight by period", func(t *testing.T) {
		if got := SelectWeightByPeriod(readings, PeriodMorning); got == nil || got.Value != 70.1 {
			t.Fatalf("morning weight = %#v, want 70.1", got)
		}
		if got := SelectWeightByPeriod(readings, PeriodEvening); got == nil || got.Value != 70.3 {
			t.Fatalf("evening weight = %#v, want 70.3", got)
		}
		if got := SelectWeightByPeriod(readings[2:], PeriodMorning); got != nil {
			t.Fatalf("weight without weight readings = %#v, want nil", got)
		}
	})

	t.Run("readings around weight anchor", func(t *testing.T) {
		anchored := append(readings,
			MeasurementReading{Kind: KindBodyTemperature, Value: 36.4, Unit: UnitCelsius, MeasuredAt: "2026-06-18T06:55:00.000Z", Source: "apple_health_export"},
			MeasurementReading{Kind: KindBodyTemperature, Value: 36.7, Unit: UnitCelsius, MeasuredAt: "2026-06-18T07:03:00.000Z", Source: "apple_health_export"},
			MeasurementReading{Kind: KindPulse, Value: 65, Unit: UnitBPM, MeasuredAt: "2026-06-18T07:11:00.000Z", Source: "apple_health_export"},
		)
		morning := SelectReadingsByWeightAnchor(anchored, PeriodMorning)
		evening := SelectReadingsByWeightAnchor(anchored, PeriodEvening)
		if got := morning[KindWeight].Value; got != 70.1 {
			t.Fatalf("morning anchor weight = %v, want 70.1", got)
		}
		if got := morning[KindBodyTemperature].Value; got != 36.7 {
			t.Fatalf("morning closest temperature = %v, want 36.7", got)
		}
		if got := evening[KindWeight].Value; got != 70.3 {
			t.Fatalf("evening anchor weight = %v, want 70.3", got)
		}
		if got := SelectReadingsByWeightAnchor(anchored[3:], PeriodMorning); len(got) != 0 {
			t.Fatalf("without weight anchor = %#v, want empty", got)
		}
	})

	t.Run("rounding resolution", func(t *testing.T) {
		cases := []struct {
			kind MeasurementKind
			in   float64
			want float64
		}{
			{KindWeight, 68.19999694824219, 68.2},
			{KindBodyTemperature, 36.66, 36.7},
			{KindBloodPressureSystolic, 120.6, 121},
			{KindPulse, 63.6, 64},
		}
		for _, tc := range cases {
			if got := RoundToMeasurementResolution(tc.in, tc.kind); got != tc.want {
				t.Errorf("round(%s, %v) = %v, want %v", tc.kind, tc.in, got, tc.want)
			}
		}
	})
}
