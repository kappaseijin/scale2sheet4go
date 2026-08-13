package pipeline

import (
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"syscall"
	"time"

	"github.com/kappaseijin/scale2sheet4go/internal/domain"
	"github.com/kappaseijin/scale2sheet4go/internal/sources/scaleexporter"
)

const (
	InputReadAttempts      = 3
	InputStabilityInterval = 5 * time.Second
)

type InputSnapshotCounts struct {
	MatchedFileCount int `json:"matchedFileCount,omitempty"`
	ReadLineCount    int `json:"readLineCount,omitempty"`
}

type InputSnapshotError struct {
	Outcome                string
	Diagnostic             string
	Counts                 InputSnapshotCounts
	InputAnomalyCandidates []scaleexporter.InputAnomalyCandidate
}

func (e *InputSnapshotError) Error() string {
	if e.Diagnostic == "" {
		return "pipeline input " + e.Outcome
	}
	return "pipeline input " + e.Outcome + ": " + e.Diagnostic
}

type ReadStableInputSnapshotOptions struct {
	OutputDir         string
	TargetDate        string
	Delay             func(time.Duration)
	AfterReadSnapshot func() error
}

type StableInputSnapshot struct {
	MatchedFileCount       int
	ReadLineCount          int
	Readings               []domain.MeasurementReading
	InputAnomalyCandidates []scaleexporter.InputAnomalyCandidate
}

type snapshotFile struct {
	Name    string
	Path    string
	Device  uint64
	Inode   uint64
	Size    int64
	MtimeNs int64
}

type inputSnapshotFiles struct {
	Files                  []snapshotFile
	InputAnomalyCandidates []scaleexporter.InputAnomalyCandidate
}

type snapshotParseError struct {
	ReadLineCount int
	Err           error
}

func (e *snapshotParseError) Error() string { return e.Err.Error() }
func (e *snapshotParseError) Unwrap() error { return e.Err }

func ReadStableInputSnapshot(options ReadStableInputSnapshotOptions) (StableInputSnapshot, error) {
	delay := options.Delay
	if delay == nil {
		delay = time.Sleep
	}
	var strongest *InputSnapshotError
	recordFailure := func(observation *InputSnapshotError) {
		if strongest == nil || failureStrength(observation.Outcome) >= failureStrength(strongest.Outcome) {
			strongest = observation
		}
	}
	for attempt := 1; attempt <= InputReadAttempts; attempt++ {
		before, err := snapshotTargetFiles(options.OutputDir, options.TargetDate)
		if err != nil {
			return StableInputSnapshot{}, err
		}
		if len(before.Files) == 0 {
			recordFailure(&InputSnapshotError{
				Outcome:                "input-missing",
				Diagnostic:             fmt.Sprintf("no target-date files found for %s", options.TargetDate),
				Counts:                 InputSnapshotCounts{MatchedFileCount: 0},
				InputAnomalyCandidates: before.InputAnomalyCandidates,
			})
		} else {
			delay(InputStabilityInterval)
			afterDelay, err := snapshotTargetFiles(options.OutputDir, options.TargetDate)
			if err != nil {
				return StableInputSnapshot{}, err
			}
			if !sameSnapshot(before.Files, afterDelay.Files) {
				recordFailure(&InputSnapshotError{
					Outcome:                "input-unstable",
					Diagnostic:             "input file metadata changed during stability window",
					Counts:                 InputSnapshotCounts{MatchedFileCount: len(afterDelay.Files)},
					InputAnomalyCandidates: afterDelay.InputAnomalyCandidates,
				})
			} else {
				parsed, parseErr := readSnapshot(afterDelay.Files)
				if parseErr == nil {
					if options.AfterReadSnapshot != nil {
						if err := options.AfterReadSnapshot(); err != nil {
							return StableInputSnapshot{}, err
						}
					}
					afterRead, err := snapshotTargetFiles(options.OutputDir, options.TargetDate)
					if err != nil {
						return StableInputSnapshot{}, err
					}
					if sameSnapshot(afterDelay.Files, afterRead.Files) {
						return StableInputSnapshot{
							MatchedFileCount:       len(afterRead.Files),
							ReadLineCount:          parsed.ReadLineCount,
							Readings:               parsed.Readings,
							InputAnomalyCandidates: afterRead.InputAnomalyCandidates,
						}, nil
					}
					recordFailure(&InputSnapshotError{
						Outcome:                "input-unstable",
						Diagnostic:             "input file metadata changed after reading snapshot",
						Counts:                 InputSnapshotCounts{MatchedFileCount: len(afterRead.Files)},
						InputAnomalyCandidates: afterRead.InputAnomalyCandidates,
					})
				} else {
					failure := &InputSnapshotError{
						Outcome:                "input-invalid-or-partial",
						Diagnostic:             parseErr.Error(),
						Counts:                 InputSnapshotCounts{MatchedFileCount: len(afterDelay.Files)},
						InputAnomalyCandidates: afterDelay.InputAnomalyCandidates,
					}
					var snapshotErr *snapshotParseError
					if errors.As(parseErr, &snapshotErr) {
						failure.Counts.ReadLineCount = snapshotErr.ReadLineCount
					}
					recordFailure(failure)
				}
			}
		}
		if attempt < InputReadAttempts {
			delay(InputStabilityInterval)
		}
	}
	if strongest == nil {
		return StableInputSnapshot{}, errors.New("input snapshot did not produce a result")
	}
	return StableInputSnapshot{}, strongest
}

func failureStrength(outcome string) int {
	switch outcome {
	case "input-invalid-or-partial":
		return 3
	case "input-unstable":
		return 2
	default:
		return 1
	}
}

func snapshotTargetFiles(outputDir, targetDate string) (inputSnapshotFiles, error) {
	entries, err := os.ReadDir(outputDir)
	if errors.Is(err, fs.ErrNotExist) {
		return inputSnapshotFiles{}, nil
	}
	if err != nil {
		return inputSnapshotFiles{}, err
	}
	names := make([]string, 0, len(entries))
	for _, entry := range entries {
		if !entry.IsDir() {
			names = append(names, entry.Name())
		}
	}
	classification := scaleexporter.ClassifyFileNames(names, targetDate)
	files := make([]snapshotFile, 0, len(classification.TargetFileNames))
	for _, name := range classification.TargetFileNames {
		path := filepath.Join(outputDir, name)
		info, err := os.Stat(path)
		if err != nil {
			return inputSnapshotFiles{}, err
		}
		file := snapshotFile{Name: name, Path: path, Size: info.Size(), MtimeNs: info.ModTime().UnixNano()}
		if stat, ok := info.Sys().(*syscall.Stat_t); ok {
			file.Device = uint64(stat.Dev)
			file.Inode = uint64(stat.Ino)
		}
		files = append(files, file)
	}
	return inputSnapshotFiles{Files: files, InputAnomalyCandidates: classification.InputAnomalyCandidates}, nil
}

func sameSnapshot(left, right []snapshotFile) bool {
	if len(left) != len(right) {
		return false
	}
	for index, file := range left {
		candidate := right[index]
		if file.Name != candidate.Name || file.Device != candidate.Device || file.Inode != candidate.Inode || file.Size != candidate.Size || file.MtimeNs != candidate.MtimeNs {
			return false
		}
	}
	return true
}

type parsedSnapshot struct {
	Readings      []domain.MeasurementReading
	ReadLineCount int
}

func readSnapshot(files []snapshotFile) (parsedSnapshot, error) {
	parsed := parsedSnapshot{}
	for _, file := range files {
		data, err := os.ReadFile(file.Path)
		if err != nil {
			return parsed, err
		}
		lines := splitLines(string(data))
		for index, line := range lines {
			if len(trimSpace(line)) == 0 {
				continue
			}
			parsed.ReadLineCount++
			reading, err := scaleexporter.ParseReadingLine(line, file.Name, index+1)
			if err != nil {
				return parsed, &snapshotParseError{ReadLineCount: parsed.ReadLineCount, Err: err}
			}
			parsed.Readings = append(parsed.Readings, reading)
		}
	}
	return parsed, nil
}

func splitLines(value string) []string {
	lines := make([]string, 0)
	start := 0
	for index := 0; index < len(value); index++ {
		if value[index] == '\n' {
			lines = append(lines, value[start:index])
			start = index + 1
		}
	}
	if start < len(value) {
		lines = append(lines, value[start:])
	}
	return lines
}

func trimSpace(value string) string {
	start, end := 0, len(value)
	for start < end {
		if value[start] > ' ' {
			break
		}
		start++
	}
	for end > start && value[end-1] <= ' ' {
		end--
	}
	return value[start:end]
}

// Keep deterministic snapshots even on filesystems that return directory entries in arbitrary order.
func sortSnapshotFiles(files []snapshotFile) {
	sort.Slice(files, func(i, j int) bool { return files[i].Name < files[j].Name })
}
