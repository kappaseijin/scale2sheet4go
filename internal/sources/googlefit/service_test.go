package googlefit

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/kappaseijin/scale2sheet4go/internal/config"
	"github.com/kappaseijin/scale2sheet4go/internal/domain"
)

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(request *http.Request) (*http.Response, error) { return f(request) }

func TestReadMeasurementsWithHTTPClientReadsSupportedTypesAndSkipsOptionalType(t *testing.T) {
	reference := time.Date(2026, 8, 13, 23, 59, 59, 999_000_000, time.FixedZone("JST", 9*60*60))
	endNanos := reference.UnixMilli() * 1_000_000
	seenTypes := map[string]int{}
	client := &http.Client{Transport: roundTripFunc(func(request *http.Request) (*http.Response, error) {
		dataType := request.URL.Query().Get("dataTypeName")
		if dataType != "" {
			seenTypes[dataType]++
			return jsonResponse(http.StatusOK, fmt.Sprintf(`{"dataSource":[{"dataStreamId":"raw:%s"}]}`, dataType)), nil
		}
		path := request.URL.Path
		if strings.Contains(path, "com.google.body.temperature") {
			return jsonResponse(http.StatusNotFound, `{"error":{"code":404,"message":"missing"}}`), nil
		}
		if strings.Contains(path, "com.google.weight") {
			return jsonResponse(http.StatusOK, fmt.Sprintf(`{"point":[{"endTimeNanos":"%d","originDataSourceId":"raw:scale","value":[{"fpVal":68.4}]}]}`, endNanos)), nil
		}
		if strings.Contains(path, "com.google.blood_pressure") {
			return jsonResponse(http.StatusOK, fmt.Sprintf(`{"point":[{"endTimeNanos":"%d","value":[{"fpVal":128},{"fpVal":82}]}]}`, endNanos)), nil
		}
		if strings.Contains(path, "com.google.heart_rate.bpm") {
			return jsonResponse(http.StatusOK, fmt.Sprintf(`{"point":[{"startTimeNanos":"%d","value":[{"intVal":64}]}]}`, endNanos-1_000_000)), nil
		}
		return jsonResponse(http.StatusNotFound, `{"error":{"code":404,"message":"unknown"}}`), nil
	})}

	readings, err := ReadMeasurementsWithHTTPClient(context.Background(), config.GoogleFitAuthConfig{LookbackDays: 14}, client, reference)
	if err != nil {
		t.Fatal(err)
	}
	if len(readings) != 4 {
		t.Fatalf("readings = %#v, want four supported values", readings)
	}
	if seenTypes["com.google.weight"] != 1 || seenTypes["com.google.body.temperature"] != 1 || seenTypes["com.google.blood_pressure"] != 1 || seenTypes["com.google.heart_rate.bpm"] != 1 {
		t.Fatalf("data type requests = %#v", seenTypes)
	}
	if readings[0].Kind != domain.KindWeight || readings[1].Kind != domain.KindBloodPressureSystolic || readings[2].Kind != domain.KindBloodPressureDiastolic || readings[3].Kind != domain.KindPulse {
		t.Fatalf("reading order = %#v", readings)
	}
	if readings[0].Value != 68.4 || readings[1].Value != 128 || readings[2].Value != 82 || readings[3].Value != 64 {
		t.Fatalf("reading values = %#v", readings)
	}
	if readings[0].MeasuredAt != reference.UTC().Format("2006-01-02T15:04:05.000Z") {
		t.Fatalf("measuredAt = %q", readings[0].MeasuredAt)
	}
}

func TestReadMeasurementsWithHTTPClientRejectsInvalidLookback(t *testing.T) {
	_, err := ReadMeasurementsWithHTTPClient(context.Background(), config.GoogleFitAuthConfig{}, &http.Client{}, time.Now())
	if err == nil || !strings.Contains(err.Error(), "lookback") {
		t.Fatalf("error = %v", err)
	}
}

func jsonResponse(status int, body string) *http.Response {
	return &http.Response{
		StatusCode: status,
		Header:     make(http.Header),
		Body:       io.NopCloser(strings.NewReader(body)),
	}
}
