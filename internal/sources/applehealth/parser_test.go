package applehealth

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/kappaseijin/scale2sheet4go/internal/domain"
)

func TestParseMeasurements(t *testing.T) {
	const exportXML = `<?xml version="1.0" encoding="UTF-8"?>
<HealthData>
  <Record type="HKQuantityTypeIdentifierBodyMass" sourceName="Scale" unit="kg" value="70.1" startDate="2026-06-18 07:00:00 +0900" endDate="2026-06-18 07:00:00 +0900" creationDate="2026-06-18 07:00:01 +0900"/>
  <Record type="HKQuantityTypeIdentifierBodyMass" sourceName="Scale" unit="kg" value="70.3" startDate="2026-06-18 07:05:00 +0900" endDate="2026-06-18 07:05:00 +0900" creationDate="2026-06-18 07:05:01 +0900"/>
  <Record type="HKQuantityTypeIdentifierBodyTemperature" sourceName="Thermometer" unit="degF" value="98.6" startDate="2026-06-18 07:01:00 +0900" endDate="2026-06-18 07:01:00 +0900" creationDate="2026-06-18 07:01:01 +0900"/>
  <Record type="HKQuantityTypeIdentifierBloodPressureSystolic" sourceName="Cuff" unit="mmHg" value="121" startDate="2026-06-18 07:02:00 +0900" endDate="2026-06-18 07:02:00 +0900" creationDate="2026-06-18 07:02:01 +0900"/>
  <Record type="HKQuantityTypeIdentifierBloodPressureDiastolic" sourceName="Cuff" unit="mmHg" value="78" startDate="2026-06-18 07:02:00 +0900" endDate="2026-06-18 07:02:00 +0900" creationDate="2026-06-18 07:02:01 +0900"/>
  <Record type="HKQuantityTypeIdentifierHeartRate" sourceName="Watch" unit="count/min" value="64" startDate="2026-06-18 07:03:00 +0900" endDate="2026-06-18 07:03:00 +0900" creationDate="2026-06-18 07:03:01 +0900"/>
</HealthData>`

	path := filepath.Join(t.TempDir(), "export.xml")
	if err := os.WriteFile(path, []byte(exportXML), 0o644); err != nil {
		t.Fatal(err)
	}
	readings, err := ParseMeasurements(path)
	if err != nil {
		t.Fatal(err)
	}
	if len(readings) != 6 {
		t.Fatalf("len(readings) = %d, want 6", len(readings))
	}
	latest := domain.LatestByKind(readings)
	if got := latest[domain.KindWeight].Value; got != 70.3 {
		t.Fatalf("latest weight = %v, want 70.3", got)
	}
	if got := latest[domain.KindBodyTemperature].Value; got < 36.99 || got > 37.01 {
		t.Fatalf("temperature = %v, want about 37", got)
	}
	if got := latest[domain.KindBloodPressureSystolic].Value; got != 121 {
		t.Fatalf("systolic = %v, want 121", got)
	}
	if got := latest[domain.KindPulse].Value; got != 64 {
		t.Fatalf("pulse = %v, want 64", got)
	}
	if got := latest[domain.KindWeight].MeasuredAt; got != "2026-06-17T22:05:00.000Z" {
		t.Fatalf("measuredAt = %q, want 2026-06-17T22:05:00.000Z", got)
	}
}

func TestUnsupportedOrInvalidRecordsAreIgnored(t *testing.T) {
	const exportXML = `<HealthData>
  <Record type="HKQuantityTypeIdentifierStepCount" unit="count" value="10" startDate="2026-06-18 07:00:00 +0900"/>
  <Record type="HKQuantityTypeIdentifierBodyMass" unit="stones" value="10" startDate="2026-06-18 07:00:00 +0900"/>
  <Record type="HKQuantityTypeIdentifierBodyMass" unit="kg" value="not-a-number" startDate="2026-06-18 07:00:00 +0900"/>
</HealthData>`
	path := filepath.Join(t.TempDir(), "export.xml")
	if err := os.WriteFile(path, []byte(exportXML), 0o644); err != nil {
		t.Fatal(err)
	}
	readings, err := ParseMeasurements(path)
	if err != nil {
		t.Fatal(err)
	}
	if len(readings) != 0 {
		t.Fatalf("len(readings) = %d, want 0", len(readings))
	}
}
