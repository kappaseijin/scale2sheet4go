package service

import (
	"math"
	"strconv"
	"time"

	"github.com/kappaseijin/scale2sheet4go/internal/domain"
)

type PeriodWindow struct {
	StartMinute int
	EndMinute   int
}

var measurementPeriodWindows = map[domain.MeasurementPeriod]PeriodWindow{
	domain.PeriodMorning: {StartMinute: 5 * 60, EndMinute: 12 * 60},
	domain.PeriodEvening: {StartMinute: 20 * 60, EndMinute: 23*60 + 30},
}

func FilterReadingsByPeriodWindow(readings []domain.MeasurementReading, period domain.MeasurementPeriod, referenceTime time.Time, timeZone *time.Location) []domain.MeasurementReading {
	if timeZone == nil {
		timeZone = time.UTC
	}
	target := referenceTime.In(timeZone)
	window, ok := measurementPeriodWindows[period]
	if !ok {
		return nil
	}
	filtered := make([]domain.MeasurementReading, 0, len(readings))
	for _, reading := range readings {
		measuredAt, err := time.Parse(time.RFC3339Nano, reading.MeasuredAt)
		if err != nil {
			continue
		}
		local := measuredAt.In(timeZone)
		minutes := local.Hour()*60 + local.Minute()
		if local.Year() == target.Year() && local.YearDay() == target.YearDay() && minutes >= window.StartMinute && minutes <= window.EndMinute {
			filtered = append(filtered, reading)
		}
	}
	return filtered
}

func IsReadingInPeriodWindow(reading domain.MeasurementReading, period domain.MeasurementPeriod, referenceTime time.Time, timeZone *time.Location) bool {
	return len(FilterReadingsByPeriodWindow([]domain.MeasurementReading{reading}, period, referenceTime, timeZone)) == 1
}

func DeduplicateExactReadings(readings []domain.MeasurementReading) []domain.MeasurementReading {
	seen := make(map[string]struct{}, len(readings))
	retained := make([]domain.MeasurementReading, 0, len(readings))
	for _, reading := range readings {
		key := reading.MeasuredAt + "|" + string(reading.Kind) + "|" + formatFloat(reading.Value) + "|" + reading.Source
		if _, exists := seen[key]; exists {
			continue
		}
		seen[key] = struct{}{}
		retained = append(retained, reading)
	}
	return retained
}

func DeduplicateCrossSourceReadings(readings []domain.MeasurementReading) []domain.MeasurementReading {
	retained := make([]domain.MeasurementReading, 0, len(readings))
	for _, reading := range readings {
		duplicate := false
		for _, other := range retained {
			if other.Source == reading.Source || other.Kind != reading.Kind || other.MeasuredAt != reading.MeasuredAt {
				continue
			}
			denominator := math.Max(math.Max(math.Abs(other.Value), math.Abs(reading.Value)), 1)
			if math.Abs(other.Value-reading.Value)/denominator <= 1e-5 {
				duplicate = true
				break
			}
		}
		if !duplicate {
			retained = append(retained, reading)
		}
	}
	return retained
}

func CountMeasurements(readings []domain.MeasurementReading) domain.MeasurementCounts {
	published := DeduplicateExactReadings(readings)
	return domain.MeasurementCounts{
		WindowedReadingCount:   len(published),
		UniqueMeasurementCount: len(DeduplicateCrossSourceReadings(published)),
	}
}

func BuildLatestMeasurementSet(readings []domain.MeasurementReading, period domain.MeasurementPeriod, capturedAt string) domain.LatestMeasurementSet {
	published := DeduplicateExactReadings(readings)
	unique := DeduplicateCrossSourceReadings(published)
	selected := domain.SelectReadingsByWeightAnchor(unique, period)
	sources := make(map[string]struct{})
	sourcesByKind := make(map[domain.MeasurementKind]string)
	for kind, reading := range selected {
		sources[reading.Source] = struct{}{}
		sourcesByKind[kind] = reading.Source
	}
	source := "mixed"
	if len(sources) == 1 {
		for name := range sources {
			source = name
		}
	}
	set := domain.LatestMeasurementSet{
		Period:        period,
		CapturedAt:    capturedAt,
		Source:        source,
		Counts:        domain.MeasurementCounts{WindowedReadingCount: len(published), UniqueMeasurementCount: len(unique)},
		SourcesByKind: sourcesByKind,
	}
	if weight, ok := selected[domain.KindWeight]; ok {
		set.CapturedAt = weight.MeasuredAt
		set.WeightKg = numberPointer(domain.RoundToMeasurementResolution(weight.Value, domain.KindWeight))
	}
	if reading, ok := selected[domain.KindBodyTemperature]; ok {
		set.BodyTemperatureCelsius = numberPointer(domain.RoundToMeasurementResolution(reading.Value, domain.KindBodyTemperature))
	}
	if reading, ok := selected[domain.KindBloodPressureSystolic]; ok {
		set.BloodPressureSystolicMmHg = numberPointer(reading.Value)
	}
	if reading, ok := selected[domain.KindBloodPressureDiastolic]; ok {
		set.BloodPressureDiastolicMmHg = numberPointer(reading.Value)
	}
	if reading, ok := selected[domain.KindPulse]; ok {
		set.PulseBpm = numberPointer(reading.Value)
	}
	return set
}

func DetermineMeasurementPeriod(referenceTime time.Time, timeZone *time.Location) domain.MeasurementPeriod {
	if timeZone == nil {
		timeZone = time.UTC
	}
	if referenceTime.In(timeZone).Hour() < 12 {
		return domain.PeriodMorning
	}
	return domain.PeriodEvening
}

func formatFloat(value float64) string {
	return strconv.FormatFloat(value, 'g', -1, 64)
}

func numberPointer(value float64) *float64 {
	return &value
}
