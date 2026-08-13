package scaleexporter

import (
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"

	"github.com/kappaseijin/scale2sheet4go/internal/domain"
)

type Config struct {
	OutputDir string
}

type InputAnomalyReason string

const InputAnomalyFileNamePatternMismatch InputAnomalyReason = "file-name-pattern-mismatch"

type InputAnomalyCandidate struct {
	Name   string
	Reason InputAnomalyReason
}

type FileClassification struct {
	TargetFileNames        []string
	InputAnomalyCandidates []InputAnomalyCandidate
}

type FileError struct {
	Message string
}

func (e *FileError) Error() string { return e.Message }

var (
	fileNamePattern       = regexp.MustCompile(`^scale_exporter_([0-9]{4}-[0-9]{2}-[0-9]{2})_(apple-health|google-fit)_([0-9]{3})\.jsonl$`)
	nearMissFilePattern   = regexp.MustCompile(`^scale_exporter_([0-9]{4}-[0-9]{2}-[0-9]{2})_.+\.jsonl$`)
	finderCopyFilePattern = regexp.MustCompile(`^(.+\.jsonl)のコピー[0-9]*$`)
)

var exporterKindToDomainKind = map[string]domain.MeasurementKind{
	"weight":                 domain.KindWeight,
	"bodyTemperature":        domain.KindBodyTemperature,
	"bloodPressureSystolic":  domain.KindBloodPressureSystolic,
	"bloodPressureDiastolic": domain.KindBloodPressureDiastolic,
	"heartRate":              domain.KindPulse,
}

var validUnits = map[string]domain.MeasurementUnit{
	"kg":      domain.UnitKg,
	"celsius": domain.UnitCelsius,
	"mmHg":    domain.UnitMmHg,
	"bpm":     domain.UnitBPM,
}

func ReadMeasurements(config Config, referenceTime time.Time, timeZone *time.Location) ([]domain.MeasurementReading, error) {
	if timeZone == nil {
		timeZone = time.UTC
	}
	targetDate := referenceTime.In(timeZone).Format("2006-01-02")
	fileNames, err := listTargetFiles(config.OutputDir, targetDate)
	if err != nil {
		return nil, err
	}

	readings := make([]domain.MeasurementReading, 0)
	seen := make(map[string]struct{})
	for _, fileName := range fileNames {
		filePath := filepath.Join(config.OutputDir, fileName)
		content, err := os.ReadFile(filePath)
		if err != nil {
			return nil, err
		}
		for lineNumber, line := range strings.Split(string(content), "\n") {
			if strings.TrimSpace(line) == "" {
				continue
			}
			reading, err := ParseReadingLine(line, fileName, lineNumber+1)
			if err != nil {
				return nil, err
			}
			key := fmt.Sprintf("%s|%s|%.17g|%s", reading.MeasuredAt, reading.Kind, reading.Value, reading.Source)
			if _, exists := seen[key]; exists {
				continue
			}
			seen[key] = struct{}{}
			readings = append(readings, reading)
		}
	}
	return readings, nil
}

func listTargetFiles(outputDir, targetDate string) ([]string, error) {
	entries, err := os.ReadDir(outputDir)
	if errors.Is(err, fs.ErrNotExist) {
		return []string{}, nil
	}
	if err != nil {
		return nil, err
	}
	names := make([]string, 0, len(entries))
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		names = append(names, entry.Name())
	}
	return ClassifyFileNames(names, targetDate).TargetFileNames, nil
}

func IsTargetFile(name, targetDate string) bool {
	match := fileNamePattern.FindStringSubmatch(name)
	return match != nil && match[1] == targetDate
}

func ClassifyFileNames(names []string, targetDate string) FileClassification {
	targetFiles := make([]string, 0)
	anomalies := make([]InputAnomalyCandidate, 0)
	seenAnomalies := make(map[string]struct{})
	for _, name := range names {
		comparisonName := name
		if IsTargetFile(comparisonName, targetDate) {
			targetFiles = append(targetFiles, name)
			continue
		}
		if copied := finderCopyFilePattern.FindStringSubmatch(comparisonName); copied != nil && IsTargetFile(copied[1], targetDate) {
			continue
		}
		nearMiss := nearMissFilePattern.FindStringSubmatch(comparisonName)
		if nearMiss == nil || nearMiss[1] != targetDate {
			continue
		}
		key := name + "\x00" + string(InputAnomalyFileNamePatternMismatch)
		if _, exists := seenAnomalies[key]; exists {
			continue
		}
		seenAnomalies[key] = struct{}{}
		anomalies = append(anomalies, InputAnomalyCandidate{
			Name:   name,
			Reason: InputAnomalyFileNamePatternMismatch,
		})
	}
	sort.Strings(targetFiles)
	sort.Slice(anomalies, func(i, j int) bool { return anomalies[i].Name < anomalies[j].Name })
	return FileClassification{TargetFileNames: targetFiles, InputAnomalyCandidates: anomalies}
}

func ParseReadingLine(line, fileName string, lineNumber int) (domain.MeasurementReading, error) {
	var value struct {
		MeasuredAt string  `json:"measuredAt"`
		Kind       string  `json:"kind"`
		Value      float64 `json:"value"`
		Unit       string  `json:"unit"`
		Source     string  `json:"source"`
	}
	if err := json.Unmarshal([]byte(line), &value); err != nil {
		return domain.MeasurementReading{}, &FileError{Message: fmt.Sprintf("invalid JSON in %s:%d", fileName, lineNumber)}
	}
	kind, kindOK := exporterKindToDomainKind[value.Kind]
	unit, unitOK := validUnits[value.Unit]
	if value.MeasuredAt == "" || !kindOK || !unitOK || strings.TrimSpace(value.Source) == "" {
		return domain.MeasurementReading{}, &FileError{Message: fmt.Sprintf("invalid reading in %s:%d", fileName, lineNumber)}
	}
	return domain.MeasurementReading{
		Kind:       kind,
		Value:      value.Value,
		Unit:       unit,
		MeasuredAt: value.MeasuredAt,
		Source:     value.Source,
	}, nil
}
