package googlefit

import (
	"context"
	"errors"
	"fmt"
	"math"
	"net/http"
	"sort"
	"time"

	"github.com/kappaseijin/scale2sheet4go/internal/auth"
	"github.com/kappaseijin/scale2sheet4go/internal/config"
	"github.com/kappaseijin/scale2sheet4go/internal/domain"
	"google.golang.org/api/fitness/v1"
	"google.golang.org/api/googleapi"
	"google.golang.org/api/option"
)

type googleFitQuery struct {
	dataTypeName string
	optional     bool
	extract      func(*fitness.DataPoint) []domain.MeasurementReading
}

var googleFitQueries = []googleFitQuery{
	{
		dataTypeName: "com.google.weight",
		extract: func(point *fitness.DataPoint) []domain.MeasurementReading {
			return singleValueReadings(point, domain.KindWeight, domain.UnitKg, 0)
		},
	},
	{
		dataTypeName: "com.google.body.temperature",
		optional:     true,
		extract: func(point *fitness.DataPoint) []domain.MeasurementReading {
			return singleValueReadings(point, domain.KindBodyTemperature, domain.UnitCelsius, 0)
		},
	},
	{
		dataTypeName: "com.google.blood_pressure",
		extract: func(point *fitness.DataPoint) []domain.MeasurementReading {
			readings := singleValueReadings(point, domain.KindBloodPressureSystolic, domain.UnitMmHg, 0)
			return append(readings, singleValueReadings(point, domain.KindBloodPressureDiastolic, domain.UnitMmHg, 1)...)
		},
	},
	{
		dataTypeName: "com.google.heart_rate.bpm",
		extract: func(point *fitness.DataPoint) []domain.MeasurementReading {
			return singleValueReadings(point, domain.KindPulse, domain.UnitBPM, 0)
		},
	},
}

// ReadMeasurements loads the saved OAuth token and reads all supported Google
// Fit data types for the configured lookback window.
func ReadMeasurements(ctx context.Context, settings config.GoogleFitAuthConfig, referenceTime time.Time) ([]domain.MeasurementReading, error) {
	client, err := auth.LoadGoogleFitOAuthClient(settings)
	if err != nil {
		return nil, err
	}
	httpClient, err := client.HTTPClient(ctx)
	if err != nil {
		return nil, err
	}
	return ReadMeasurementsWithHTTPClient(ctx, settings, httpClient, referenceTime)
}

// ReadMeasurementsWithHTTPClient keeps the transport injectable for tests and
// for callers that need to supply a custom OAuth2-aware client.
func ReadMeasurementsWithHTTPClient(ctx context.Context, settings config.GoogleFitAuthConfig, httpClient *http.Client, referenceTime time.Time) ([]domain.MeasurementReading, error) {
	if ctx == nil {
		ctx = context.Background()
	}
	if httpClient == nil {
		return nil, fmt.Errorf("Google Fit HTTP client is nil")
	}
	if settings.LookbackDays <= 0 {
		return nil, fmt.Errorf("Google Fit lookback days must be positive")
	}
	if referenceTime.IsZero() {
		referenceTime = time.Now()
	}
	fitnessService, err := fitness.NewService(ctx, option.WithHTTPClient(httpClient))
	if err != nil {
		return nil, fmt.Errorf("create Google Fit client: %w", err)
	}
	endTimeMillis := referenceTime.UnixMilli()
	startTimeMillis := referenceTime.Add(-time.Duration(settings.LookbackDays) * 24 * time.Hour).UnixMilli()
	readings := make([]domain.MeasurementReading, 0)
	for _, query := range googleFitQueries {
		points, err := readDataPointsForDataType(ctx, fitnessService, query.dataTypeName, startTimeMillis, endTimeMillis)
		if err != nil {
			if query.optional && isMissingDataTypeError(err) {
				continue
			}
			return nil, err
		}
		sort.SliceStable(points, func(i, j int) bool { return pointMillis(points[i]) < pointMillis(points[j]) })
		for _, point := range points {
			if point == nil || len(point.Value) == 0 {
				continue
			}
			readings = append(readings, query.extract(point)...)
		}
	}
	return readings, nil
}

func readDataPointsForDataType(ctx context.Context, service *fitness.Service, dataTypeName string, startTimeMillis, endTimeMillis int64) ([]*fitness.DataPoint, error) {
	if startTimeMillis < 0 || endTimeMillis < 0 || startTimeMillis > endTimeMillis {
		return nil, fmt.Errorf("invalid Google Fit time range")
	}
	startNanos := startTimeMillis * 1_000_000
	endNanos := endTimeMillis * 1_000_000
	datasetID := fmt.Sprintf("%d-%d", startNanos, endNanos)
	dataSources, err := service.Users.DataSources.List("me").DataTypeName(dataTypeName).Context(ctx).Do()
	if err != nil {
		return nil, fmt.Errorf("list Google Fit data sources for %s: %w", dataTypeName, err)
	}
	points := make([]*fitness.DataPoint, 0)
	for _, dataSource := range dataSources.DataSource {
		if dataSource == nil || dataSource.DataStreamId == "" {
			continue
		}
		var pageToken string
		for {
			call := service.Users.DataSources.Datasets.Get("me", dataSource.DataStreamId, datasetID).Limit(1000).Context(ctx)
			if pageToken != "" {
				call = call.PageToken(pageToken)
			}
			dataset, err := call.Do()
			if err != nil {
				return nil, fmt.Errorf("read Google Fit dataset %s: %w", dataSource.DataStreamId, err)
			}
			points = append(points, dataset.Point...)
			pageToken = dataset.NextPageToken
			if pageToken == "" {
				break
			}
		}
	}
	return points, nil
}

func singleValueReadings(point *fitness.DataPoint, kind domain.MeasurementKind, unit domain.MeasurementUnit, valueIndex int) []domain.MeasurementReading {
	if point == nil || valueIndex < 0 || valueIndex >= len(point.Value) {
		return nil
	}
	value, ok := googleFitNumber(point.Value[valueIndex])
	if !ok {
		return nil
	}
	nanos := point.EndTimeNanos
	if nanos == 0 {
		nanos = point.StartTimeNanos
	}
	if nanos == 0 {
		return nil
	}
	return []domain.MeasurementReading{{
		Kind:           kind,
		Value:          value,
		Unit:           unit,
		MeasuredAt:     domain.CanonicalISO(time.Unix(0, nanos)),
		Source:         "google_fit",
		SourceRecordID: point.OriginDataSourceId,
	}}
}

func googleFitNumber(value *fitness.Value) (float64, bool) {
	if value == nil {
		return 0, false
	}
	if math.IsNaN(value.FpVal) || math.IsInf(value.FpVal, 0) || math.IsNaN(float64(value.IntVal)) || math.IsInf(float64(value.IntVal), 0) {
		return 0, false
	}
	if value.FpVal != 0 {
		return value.FpVal, true
	}
	return float64(value.IntVal), true
}

func pointMillis(point *fitness.DataPoint) int64 {
	if point == nil {
		return 0
	}
	nanos := point.EndTimeNanos
	if nanos == 0 {
		nanos = point.StartTimeNanos
	}
	return nanos / 1_000_000
}

func isMissingDataTypeError(err error) bool {
	var apiErr *googleapi.Error
	return errors.As(err, &apiErr) && (apiErr.Code == http.StatusBadRequest || apiErr.Code == http.StatusNotFound)
}
