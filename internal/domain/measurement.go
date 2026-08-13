package domain

import (
	"math"
	"time"
)

type MeasurementKind string

const (
	KindWeight                 MeasurementKind = "weight"
	KindBodyTemperature        MeasurementKind = "body_temperature"
	KindBloodPressureSystolic  MeasurementKind = "blood_pressure_systolic"
	KindBloodPressureDiastolic MeasurementKind = "blood_pressure_diastolic"
	KindPulse                  MeasurementKind = "pulse"
)

var MeasurementKinds = []MeasurementKind{
	KindWeight,
	KindBodyTemperature,
	KindBloodPressureSystolic,
	KindBloodPressureDiastolic,
	KindPulse,
}

type MeasurementUnit string

const (
	UnitKg      MeasurementUnit = "kg"
	UnitCelsius MeasurementUnit = "celsius"
	UnitMmHg    MeasurementUnit = "mmHg"
	UnitBPM     MeasurementUnit = "bpm"
)

type MeasurementPeriod string

const (
	PeriodMorning MeasurementPeriod = "morning"
	PeriodEvening MeasurementPeriod = "evening"
)

var PeriodLabels = map[MeasurementPeriod]string{
	PeriodMorning: "朝",
	PeriodEvening: "夜",
}

type MeasurementReading struct {
	Kind           MeasurementKind
	Value          float64
	Unit           MeasurementUnit
	MeasuredAt     string
	Source         string
	SourceRecordID string
}

type MeasurementCounts struct {
	WindowedReadingCount   int `json:"windowedReadingCount"`
	UniqueMeasurementCount int `json:"uniqueMeasurementCount"`
}

type LatestMeasurementSet struct {
	Period                     MeasurementPeriod
	CapturedAt                 string
	Source                     string
	Counts                     MeasurementCounts
	WeightKg                   *float64
	BodyTemperatureCelsius     *float64
	BloodPressureSystolicMmHg  *float64
	BloodPressureDiastolicMmHg *float64
	PulseBpm                   *float64
	SourcesByKind              map[MeasurementKind]string
}

type SpreadsheetRow struct {
	Date                       string
	Time                       string
	PeriodLabel                string
	WeightKg                   any
	BodyTemperatureCelsius     any
	BloodPressureSystolicMmHg  any
	BloodPressureDiastolicMmHg any
	PulseBpm                   any
	Source                     string
}

func RoundToMeasurementResolution(value float64, kind MeasurementKind) float64 {
	digits := 0.0
	if kind == KindWeight || kind == KindBodyTemperature {
		digits = 1
	}
	scale := math.Pow10(int(digits))
	return math.Round(value*scale) / scale
}

func LatestByKind(readings []MeasurementReading) map[MeasurementKind]MeasurementReading {
	latest := make(map[MeasurementKind]MeasurementReading)
	for _, reading := range readings {
		current, ok := latest[reading.Kind]
		if !ok || measuredAfter(reading.MeasuredAt, current.MeasuredAt) {
			latest[reading.Kind] = reading
		}
	}
	return latest
}

func SelectWeightByPeriod(readings []MeasurementReading, period MeasurementPeriod) *MeasurementReading {
	var selected *MeasurementReading
	for i := range readings {
		reading := readings[i]
		if reading.Kind != KindWeight {
			continue
		}
		if selected == nil || shouldReplaceWeight(reading, *selected, period) {
			copy := reading
			selected = &copy
		}
	}
	return selected
}

func SelectReadingsByWeightAnchor(readings []MeasurementReading, period MeasurementPeriod) map[MeasurementKind]MeasurementReading {
	selected := make(map[MeasurementKind]MeasurementReading)
	weight := SelectWeightByPeriod(readings, period)
	if weight == nil {
		return selected
	}
	selected[KindWeight] = *weight
	for _, kind := range MeasurementKinds {
		if kind == KindWeight {
			continue
		}
		if reading, ok := selectClosestToReference(readings, kind, weight.MeasuredAt); ok {
			selected[kind] = reading
		}
	}
	return selected
}

func shouldReplaceWeight(candidate, current MeasurementReading, period MeasurementPeriod) bool {
	candidateTime, candidateOK := parseMeasuredAt(candidate.MeasuredAt)
	currentTime, currentOK := parseMeasuredAt(current.MeasuredAt)
	if !candidateOK || !currentOK {
		return false
	}
	if period == PeriodMorning {
		return candidateTime.Before(currentTime)
	}
	return candidateTime.After(currentTime)
}

func selectClosestToReference(readings []MeasurementReading, kind MeasurementKind, reference string) (MeasurementReading, bool) {
	referenceTime, referenceOK := parseMeasuredAt(reference)
	var selected MeasurementReading
	var selectedTime time.Time
	selectedOK := false
	for _, reading := range readings {
		if reading.Kind != kind {
			continue
		}
		readingTime, ok := parseMeasuredAt(reading.MeasuredAt)
		if !ok || !referenceOK {
			continue
		}
		if !selectedOK || absDuration(readingTime.Sub(referenceTime)) < absDuration(selectedTime.Sub(referenceTime)) {
			selected = reading
			selectedTime = readingTime
			selectedOK = true
		}
	}
	return selected, selectedOK
}

func measuredAfter(candidate, current string) bool {
	candidateTime, candidateOK := parseMeasuredAt(candidate)
	currentTime, currentOK := parseMeasuredAt(current)
	return candidateOK && currentOK && candidateTime.After(currentTime)
}

func parseMeasuredAt(value string) (time.Time, bool) {
	parsed, err := time.Parse(time.RFC3339Nano, value)
	return parsed, err == nil
}

func absDuration(value time.Duration) time.Duration {
	if value < 0 {
		return -value
	}
	return value
}

func CanonicalISO(value time.Time) string {
	return value.UTC().Format("2006-01-02T15:04:05.000Z")
}
