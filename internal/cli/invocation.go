package cli

import (
	"fmt"
	"time"
)

type Command string

const (
	CommandAuth      Command = "auth"
	CommandDoctor    Command = "doctor"
	CommandInstall   Command = "install"
	CommandPipeline  Command = "pipeline"
	CommandRun       Command = "run"
	CommandServe     Command = "serve"
	CommandUninstall Command = "uninstall"
)

type Period string

const (
	PeriodMorning Period = "morning"
	PeriodEvening Period = "evening"
)

type Source string

const (
	SourceScaleExporter Source = "scale-exporter"
	SourceGoogleFit     Source = "google-fit"
	SourceAppleHealth   Source = "apple-health"
)

type Invocation struct {
	Command Command
	Period  Period
	Source  Source
	Date    string
	Prefix  string
	DryRun  bool
	Launchd bool
	Force   bool
	Purge   bool
	Wipe    bool
	Archive string
	Yes     bool
	Help    bool
	Version bool
}

type ArgumentError struct {
	Message string
}

func (e *ArgumentError) Error() string { return e.Message }

func argumentError(message string) error { return &ArgumentError{Message: message} }

func ExitCode(err error) int {
	if err == nil {
		return 0
	}
	if _, ok := err.(*ArgumentError); ok {
		return 2
	}
	return 1
}

func Parse(args []string) (Invocation, error) {
	if len(args) == 0 {
		return Invocation{Help: true}, nil
	}
	if args[0] == "--help" || args[0] == "-h" {
		return Invocation{Help: true}, nil
	}
	if args[0] == "--version" || args[0] == "-V" {
		return Invocation{Version: true}, nil
	}

	command := Command(args[0])
	if !isCommand(command) {
		return Invocation{}, argumentError("unknown command")
	}
	invocation := Invocation{Command: command}

	for i := 1; i < len(args); i++ {
		arg := args[i]
		switch arg {
		case "--help", "-h":
			invocation.Help = true
		case "--version", "-V":
			invocation.Version = true
		case "--period":
			value, next, err := optionValue(args, i, "period")
			if err != nil {
				return Invocation{}, err
			}
			i = next
			period, err := parsePeriod(value)
			if err != nil {
				return Invocation{}, err
			}
			invocation.Period = period
		case "--source":
			value, next, err := optionValue(args, i, "source")
			if err != nil {
				return Invocation{}, err
			}
			i = next
			source, err := parseSource(value)
			if err != nil {
				return Invocation{}, err
			}
			invocation.Source = source
		case "--date":
			value, next, err := optionValue(args, i, "date")
			if err != nil {
				return Invocation{}, err
			}
			i = next
			date, err := ParseDateOption(value)
			if err != nil {
				return Invocation{}, err
			}
			invocation.Date = date
		case "--dry-run":
			invocation.DryRun = true
		case "--launchd":
			invocation.Launchd = true
		case "--force":
			invocation.Force = true
		case "--purge":
			invocation.Purge = true
		case "--wipe":
			invocation.Wipe = true
		case "--yes":
			invocation.Yes = true
		case "--prefix":
			value, next, err := optionValue(args, i, "prefix")
			if err != nil {
				return Invocation{}, err
			}
			i = next
			invocation.Prefix = value
		case "--archive":
			value, next, err := optionValue(args, i, "archive")
			if err != nil {
				return Invocation{}, err
			}
			i = next
			invocation.Archive = value
		default:
			if len(arg) > 0 && arg[0] == '-' {
				return Invocation{}, argumentError("unknown option")
			}
			return Invocation{}, argumentError("unexpected argument")
		}
	}

	if invocation.Help || invocation.Version {
		return invocation, nil
	}
	if command == CommandRun || command == CommandPipeline {
		if invocation.Period == "" {
			return Invocation{}, argumentError("period is required")
		}
	}
	return invocation, nil
}

func ParseDateOption(value string) (string, error) {
	if len(value) != len("2006-01-02") || value[4] != '-' || value[7] != '-' {
		return "", argumentError("date must be YYYY-MM-DD")
	}
	for i, r := range value {
		if i == 4 || i == 7 {
			continue
		}
		if r < '0' || r > '9' {
			return "", argumentError("date must be YYYY-MM-DD")
		}
	}
	if _, err := time.Parse("2006-01-02", value); err != nil {
		return "", argumentError("date must be a valid YYYY-MM-DD date")
	}
	return value, nil
}

func parsePeriod(value string) (Period, error) {
	switch Period(value) {
	case PeriodMorning, PeriodEvening:
		return Period(value), nil
	default:
		return "", argumentError("period must be morning or evening")
	}
}

func parseSource(value string) (Source, error) {
	switch Source(value) {
	case SourceScaleExporter, SourceGoogleFit, SourceAppleHealth:
		return Source(value), nil
	default:
		return "", argumentError("source must be scale-exporter, google-fit or apple-health")
	}
}

func optionValue(args []string, index int, name string) (string, int, error) {
	next := index + 1
	if next >= len(args) || len(args[next]) > 0 && args[next][0] == '-' {
		return "", index, argumentError(fmt.Sprintf("%s is required", name))
	}
	return args[next], next, nil
}

func isCommand(command Command) bool {
	switch command {
	case CommandAuth, CommandDoctor, CommandInstall, CommandPipeline, CommandRun, CommandServe, CommandUninstall:
		return true
	default:
		return false
	}
}
