package googlefit

import (
	"time"

	"github.com/kappaseijin/scale2sheet4go/internal/domain"
)

type Value struct {
	FPVal  *float64
	IntVal *int64
}

type Point struct {
	StartTimeNanos     int64
	EndTimeNanos       int64
	Values             []Value
	OriginDataSourceID string
}

func ReadingFromPoint(point Point, kind domain.MeasurementKind, unit domain.MeasurementUnit, valueIndex int) (domain.MeasurementReading, bool) {
	if valueIndex < 0 || valueIndex >= len(point.Values) {
		return domain.MeasurementReading{}, false
	}
	value, ok := numberValue(point.Values[valueIndex])
	if !ok {
		return domain.MeasurementReading{}, false
	}
	nanos := point.EndTimeNanos
	if nanos == 0 {
		nanos = point.StartTimeNanos
	}
	if nanos == 0 {
		return domain.MeasurementReading{}, false
	}
	measuredAt := domain.CanonicalISO(time.Unix(0, nanos))
	return domain.MeasurementReading{
		Kind:           kind,
		Value:          value,
		Unit:           unit,
		MeasuredAt:     measuredAt,
		Source:         "google_fit",
		SourceRecordID: point.OriginDataSourceID,
	}, true
}

func numberValue(value Value) (float64, bool) {
	if value.FPVal != nil {
		return *value.FPVal, true
	}
	if value.IntVal != nil {
		return float64(*value.IntVal), true
	}
	return 0, false
}
