package sheets

import (
	"context"
	"errors"
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/kappaseijin/scale2sheet4go/internal/config"
	"github.com/kappaseijin/scale2sheet4go/internal/domain"
)

const GoogleSheetsOperationDeadline = 30 * time.Second

type OperationStage string

const (
	StageAuthOrHeaderRead OperationStage = "auth-or-header-read"
	StageDateColumnRead   OperationStage = "date-column-read"
	StageBatchUpdate      OperationStage = "batch-update"
)

type WriteConfirmation string

const (
	WriteNotAttempted WriteConfirmation = "not-attempted"
	WriteUnconfirmed  WriteConfirmation = "unconfirmed"
)

type OperationTimeoutError struct {
	Stage             OperationStage
	Deadline          time.Duration
	WriteConfirmation WriteConfirmation
}

func (e *OperationTimeoutError) Error() string {
	return fmt.Sprintf(
		"google-sheets-operation-timeout stage=%s deadlineMilliseconds=%d writeConfirmation=%s",
		e.Stage,
		e.Deadline.Milliseconds(),
		e.WriteConfirmation,
	)
}

type Logger interface {
	Log(message string)
	Error(message string)
}

type discardLogger struct{}

func (discardLogger) Log(string)   {}
func (discardLogger) Error(string) {}

type Client interface {
	Get(ctx context.Context, spreadsheetID, readRange string) ([][]any, error)
	BatchUpdate(ctx context.Context, spreadsheetID string, data []ValueRange) (*int, error)
}

type ValueRange struct {
	Range  string
	Values [][]any
}

type UpdateInput struct {
	Config    config.GoogleSheetsAuthConfig
	LatestSet domain.LatestMeasurementSet
	TimeZone  *time.Location
	Logger    Logger
	Deadline  time.Duration
}

type SheetMeasurementField string

const (
	SheetFieldWeight      SheetMeasurementField = "weight"
	SheetFieldTemperature SheetMeasurementField = "temperature"
	SheetFieldSystolicBP  SheetMeasurementField = "systolicBP"
	SheetFieldDiastolicBP SheetMeasurementField = "diastolicBP"
	SheetFieldHeartRate   SheetMeasurementField = "heartRate"
)

var sheetMeasurementFields = []SheetMeasurementField{
	SheetFieldWeight,
	SheetFieldTemperature,
	SheetFieldSystolicBP,
	SheetFieldDiastolicBP,
	SheetFieldHeartRate,
}

type SheetColumnMapping struct {
	DateColumnIndex int
	Periods         map[domain.MeasurementPeriod]map[SheetMeasurementField]int
}

type TransferOutcome = domain.TransferOutcome

const (
	TransferWritten    = domain.TransferWritten
	TransferNotWritten = domain.TransferNotWritten
	TransferUnknown    = domain.TransferUnknown
)

func UpdateSpreadsheetMeasurements(ctx context.Context, client Client, input UpdateInput) (domain.TransferOutcome, error) {
	if client == nil {
		return domain.TransferOutcome{}, errors.New("Google Sheets client is required")
	}
	deadline := input.Deadline
	if deadline <= 0 {
		deadline = GoogleSheetsOperationDeadline
	}
	timeZone := input.TimeZone
	if timeZone == nil {
		timeZone = time.UTC
	}
	logger := input.Logger
	if logger == nil {
		logger = discardLogger{}
	}
	operationCtx, cancel := context.WithTimeout(ctx, deadline)
	defer cancel()

	stage := StageAuthOrHeaderRead
	headerValues, err := client.Get(operationCtx, input.Config.SpreadsheetID, QuoteSheetName(input.Config.SheetName)+"!1:1")
	if err != nil {
		return domain.TransferOutcome{}, operationError(operationCtx, stage, deadline, err)
	}
	var headerRow []any
	if len(headerValues) > 0 {
		headerRow = headerValues[0]
	}
	mapping, err := BuildSheetColumnMapping(headerRow)
	if err != nil {
		return domain.TransferOutcome{}, err
	}

	dateColumn, err := ColumnIndexToA1(mapping.DateColumnIndex)
	if err != nil {
		return domain.TransferOutcome{}, err
	}
	stage = StageDateColumnRead
	dateValues, err := client.Get(operationCtx, input.Config.SpreadsheetID, QuoteSheetName(input.Config.SheetName)+"!"+dateColumn+":"+dateColumn)
	if err != nil {
		return domain.TransferOutcome{}, operationError(operationCtx, stage, deadline, err)
	}
	targetDate, err := time.Parse(time.RFC3339Nano, input.LatestSet.CapturedAt)
	if err != nil {
		return domain.TransferOutcome{}, fmt.Errorf("invalid capturedAt %q: %w", input.LatestSet.CapturedAt, err)
	}
	rowNumber, found := FindTodayRowNumber(dateValues, targetDate.In(timeZone))
	if !found {
		logger.Error(fmt.Sprintf("No row found in %s for %s. Nothing was written.", input.Config.SheetName, targetDate.In(timeZone).Format("2006-01-02")))
		zero := 0
		return domain.TransferOutcome{State: domain.TransferNotWritten, TransferredCellCount: &zero}, nil
	}

	data := BuildMeasurementUpdateData(input.Config.SheetName, rowNumber, input.LatestSet, mapping)
	if len(data) == 0 {
		logger.Log("No defined measurement values matched sheet columns. Nothing was written.")
		zero := 0
		return domain.TransferOutcome{State: domain.TransferNotWritten, TransferredCellCount: &zero}, nil
	}

	stage = StageBatchUpdate
	updatedCells, err := client.BatchUpdate(operationCtx, input.Config.SpreadsheetID, data)
	if err != nil {
		return domain.TransferOutcome{}, operationError(operationCtx, stage, deadline, err)
	}
	logger.Log(fmt.Sprintf("Updated %d %s measurement cell(s) in row %d.", len(data), input.LatestSet.Period, rowNumber))
	if updatedCells == nil {
		return domain.TransferOutcome{State: domain.TransferUnknown}, nil
	}
	if *updatedCells >= 1 {
		return domain.TransferOutcome{State: domain.TransferWritten, TransferredCellCount: updatedCells}, nil
	}
	return domain.TransferOutcome{State: domain.TransferNotWritten, TransferredCellCount: updatedCells}, nil
}

func operationError(ctx context.Context, stage OperationStage, deadline time.Duration, err error) error {
	if errors.Is(ctx.Err(), context.DeadlineExceeded) {
		confirmation := WriteNotAttempted
		if stage == StageBatchUpdate {
			confirmation = WriteUnconfirmed
		}
		return &OperationTimeoutError{Stage: stage, Deadline: deadline, WriteConfirmation: confirmation}
	}
	return err
}

func BuildSheetColumnMapping(headerRow []any) (SheetColumnMapping, error) {
	normalizedHeaders := make([]string, len(headerRow))
	for i, value := range headerRow {
		normalizedHeaders[i] = normalizeHeader(value)
	}
	dateColumnIndex := -1
	for i, header := range normalizedHeaders {
		if header == "月日" {
			dateColumnIndex = i
			break
		}
	}
	if dateColumnIndex == -1 {
		return SheetColumnMapping{}, errors.New(`Sheet header must contain a "月日" column.`)
	}
	mapping := SheetColumnMapping{
		DateColumnIndex: dateColumnIndex,
		Periods: map[domain.MeasurementPeriod]map[SheetMeasurementField]int{
			domain.PeriodMorning: {},
			domain.PeriodEvening: {},
		},
	}
	for index, header := range normalizedHeaders {
		if strings.HasPrefix(header, "朝") {
			if field, ok := detectMeasurementField(header[3:]); ok {
				mapping.Periods[domain.PeriodMorning][field] = index
			}
		}
		if strings.HasPrefix(header, "夜") {
			if field, ok := detectMeasurementField(header[3:]); ok {
				mapping.Periods[domain.PeriodEvening][field] = index
			}
		}
	}
	return mapping, nil
}

func FindTodayRowNumber(dateColumnValues [][]any, targetDate time.Time) (int, bool) {
	for index, row := range dateColumnValues {
		if index == 0 || len(row) == 0 {
			continue
		}
		if DoesSheetDateMatch(row[0], targetDate) {
			return index + 1, true
		}
	}
	return 0, false
}

func BuildMeasurementUpdateData(sheetName string, rowNumber int, latestSet domain.LatestMeasurementSet, mapping SheetColumnMapping) []ValueRange {
	periodColumns := mapping.Periods[latestSet.Period]
	valuesByField := make(map[SheetMeasurementField]float64)
	setDefinedValue(valuesByField, SheetFieldWeight, latestSet.WeightKg)
	setDefinedValue(valuesByField, SheetFieldTemperature, latestSet.BodyTemperatureCelsius)
	setDefinedValue(valuesByField, SheetFieldSystolicBP, latestSet.BloodPressureSystolicMmHg)
	setDefinedValue(valuesByField, SheetFieldDiastolicBP, latestSet.BloodPressureDiastolicMmHg)
	setDefinedValue(valuesByField, SheetFieldHeartRate, latestSet.PulseBpm)

	data := make([]ValueRange, 0, len(sheetMeasurementFields))
	for _, field := range sheetMeasurementFields {
		value, valueOK := valuesByField[field]
		columnIndex, columnOK := periodColumns[field]
		if !valueOK || !columnOK {
			continue
		}
		column, err := ColumnIndexToA1(columnIndex)
		if err != nil {
			continue
		}
		data = append(data, ValueRange{
			Range:  QuoteSheetName(sheetName) + "!" + column + strconv.Itoa(rowNumber),
			Values: [][]any{{value}},
		})
	}
	return data
}

func DoesSheetDateMatch(value any, targetDate time.Time) bool {
	parsed, ok := ParseSheetDate(value, targetDate)
	if !ok {
		return false
	}
	parsed = parsed.In(targetDate.Location())
	targetDate = targetDate.In(targetDate.Location())
	return parsed.Year() == targetDate.Year() && parsed.Month() == targetDate.Month() && parsed.Day() == targetDate.Day()
}

func ParseSheetDate(value any, targetDate time.Time) (time.Time, bool) {
	text := strings.TrimSpace(fmt.Sprint(value))
	if value == nil || text == "<nil>" || text == "" {
		return time.Time{}, false
	}
	location := targetDate.Location()
	if match := yearMonthDayPattern.FindStringSubmatch(text); match != nil {
		year, _ := strconv.Atoi(match[1])
		month, _ := strconv.Atoi(match[2])
		day, _ := strconv.Atoi(match[3])
		return dateFromParts(year, month, day, location)
	}
	if match := monthDayPattern.FindStringSubmatch(text); match != nil {
		monthText, dayText := match[1], match[2]
		if monthText == "" {
			monthText, dayText = match[3], match[4]
		}
		month, _ := strconv.Atoi(monthText)
		day, _ := strconv.Atoi(dayText)
		return dateFromParts(targetDate.Year(), month, day, location)
	}
	return time.Time{}, false
}

func ColumnIndexToA1(index int) (string, error) {
	if index < 0 {
		return "", errors.New("Column index must be a non-negative integer.")
	}
	column := ""
	value := index + 1
	for value > 0 {
		remainder := (value - 1) % 26
		column = string(rune('A'+remainder)) + column
		value = (value - 1) / 26
	}
	return column, nil
}

func QuoteSheetName(sheetName string) string {
	return "'" + strings.ReplaceAll(sheetName, "'", "''") + "'"
}

func setDefinedValue(values map[SheetMeasurementField]float64, field SheetMeasurementField, value *float64) {
	if value != nil {
		values[field] = *value
	}
}

func detectMeasurementField(header string) (SheetMeasurementField, bool) {
	switch {
	case strings.Contains(header, "体重"):
		return SheetFieldWeight, true
	case strings.Contains(header, "体温"):
		return SheetFieldTemperature, true
	case strings.Contains(header, "血圧上") || strings.Contains(header, "血圧(上)"):
		return SheetFieldSystolicBP, true
	case strings.Contains(header, "血圧下") || strings.Contains(header, "血圧(下)"):
		return SheetFieldDiastolicBP, true
	case strings.Contains(header, "脈拍"):
		return SheetFieldHeartRate, true
	default:
		return "", false
	}
}

func normalizeHeader(value any) string {
	return strings.TrimSpace(strings.Join(strings.Fields(fmt.Sprint(value)), ""))
}

func dateFromParts(year, month, day int, location *time.Location) (time.Time, bool) {
	date := time.Date(year, time.Month(month), day, 0, 0, 0, 0, location)
	if date.Year() != year || int(date.Month()) != month || date.Day() != day {
		return time.Time{}, false
	}
	return date, true
}

var (
	yearMonthDayPattern = regexp.MustCompile(`^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$`)
	monthDayPattern     = regexp.MustCompile(`^(?:([0-9]{1,2})/([0-9]{1,2})|([0-9]{1,2})月([0-9]{1,2})日?)$`)
)
