package applehealth

import (
	"encoding/xml"
	"io"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/kappaseijin/scale2sheet4go/internal/domain"
)

type Config struct {
	ExportXMLPath string
}

var appleHealthTypeToKind = map[string]domain.MeasurementKind{
	"HKQuantityTypeIdentifierBodyMass":               domain.KindWeight,
	"HKQuantityTypeIdentifierBodyTemperature":        domain.KindBodyTemperature,
	"HKQuantityTypeIdentifierBloodPressureSystolic":  domain.KindBloodPressureSystolic,
	"HKQuantityTypeIdentifierBloodPressureDiastolic": domain.KindBloodPressureDiastolic,
	"HKQuantityTypeIdentifierHeartRate":              domain.KindPulse,
}

func ReadMeasurements(config Config) ([]domain.MeasurementReading, error) {
	return ParseMeasurements(config.ExportXMLPath)
}

func ParseMeasurements(exportXMLPath string) ([]domain.MeasurementReading, error) {
	file, err := os.Open(exportXMLPath)
	if err != nil {
		return nil, err
	}
	defer file.Close()

	decoder := xml.NewDecoder(file)
	readings := make([]domain.MeasurementReading, 0)
	for {
		token, err := decoder.Token()
		if err == io.EOF {
			return readings, nil
		}
		if err != nil {
			return nil, err
		}
		start, ok := token.(xml.StartElement)
		if !ok || start.Name.Local != "Record" {
			continue
		}
		attributes := make(map[string]string, len(start.Attr))
		for _, attribute := range start.Attr {
			attributes[attribute.Name.Local] = attribute.Value
		}
		if reading, ok := recordToReading(attributes); ok {
			readings = append(readings, reading)
		}
	}
}

func recordToReading(attributes map[string]string) (domain.MeasurementReading, bool) {
	kind, ok := appleHealthTypeToKind[attributes["type"]]
	if !ok {
		return domain.MeasurementReading{}, false
	}
	rawValue := attributes["value"]
	rawUnit := attributes["unit"]
	measuredAt, ok := normalizeAppleDate(firstNonEmpty(attributes["endDate"], attributes["startDate"]))
	if rawValue == "" || rawUnit == "" || !ok {
		return domain.MeasurementReading{}, false
	}
	value, err := strconv.ParseFloat(rawValue, 64)
	if err != nil {
		return domain.MeasurementReading{}, false
	}
	converted, ok := convertAppleHealthValue(kind, value, rawUnit)
	if !ok {
		return domain.MeasurementReading{}, false
	}
	parts := make([]string, 0, 4)
	for _, value := range []string{attributes["sourceName"], attributes["creationDate"], attributes["type"], firstNonEmpty(attributes["endDate"], attributes["startDate"])} {
		if value != "" {
			parts = append(parts, value)
		}
	}
	return domain.MeasurementReading{
		Kind:           kind,
		Value:          converted.Value,
		Unit:           converted.Unit,
		MeasuredAt:     measuredAt,
		Source:         "apple_health_export",
		SourceRecordID: strings.Join(parts, ":"),
	}, true
}

func normalizeAppleDate(value string) (string, bool) {
	if value == "" {
		return "", false
	}
	layouts := []string{
		"2006-01-02 15:04:05 -0700",
		time.RFC3339Nano,
	}
	for _, layout := range layouts {
		parsed, err := time.Parse(layout, value)
		if err == nil {
			return domain.CanonicalISO(parsed), true
		}
	}
	return "", false
}

type convertedValue struct {
	Value float64
	Unit  domain.MeasurementUnit
}

func convertAppleHealthValue(kind domain.MeasurementKind, value float64, unit string) (convertedValue, bool) {
	switch kind {
	case domain.KindWeight:
		switch unit {
		case "kg":
			return convertedValue{Value: value, Unit: domain.UnitKg}, true
		case "g":
			return convertedValue{Value: value / 1000, Unit: domain.UnitKg}, true
		case "lb", "lbs":
			return convertedValue{Value: value * 0.45359237, Unit: domain.UnitKg}, true
		}
	case domain.KindBodyTemperature:
		switch unit {
		case "degC", "°C", "C":
			return convertedValue{Value: value, Unit: domain.UnitCelsius}, true
		case "degF", "°F", "F":
			return convertedValue{Value: (value - 32) * 5 / 9, Unit: domain.UnitCelsius}, true
		}
	case domain.KindBloodPressureSystolic, domain.KindBloodPressureDiastolic:
		if unit == "mmHg" {
			return convertedValue{Value: value, Unit: domain.UnitMmHg}, true
		}
	case domain.KindPulse:
		if unit == "count/min" || unit == "/min" {
			return convertedValue{Value: value, Unit: domain.UnitBPM}, true
		}
	}
	return convertedValue{}, false
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if value != "" {
			return value
		}
	}
	return ""
}
