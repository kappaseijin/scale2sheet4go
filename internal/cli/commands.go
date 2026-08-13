package cli

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"runtime"
	"strings"
	"syscall"
	"time"

	"github.com/kappaseijin/scale2sheet4go/internal/auth"
	"github.com/kappaseijin/scale2sheet4go/internal/config"
	"github.com/kappaseijin/scale2sheet4go/internal/domain"
	"github.com/kappaseijin/scale2sheet4go/internal/installation"
	"github.com/kappaseijin/scale2sheet4go/internal/pipeline"
	"github.com/kappaseijin/scale2sheet4go/internal/scheduler"
	"github.com/kappaseijin/scale2sheet4go/internal/service"
	"github.com/kappaseijin/scale2sheet4go/internal/sheets"
	"github.com/kappaseijin/scale2sheet4go/internal/sources/applehealth"
	"github.com/kappaseijin/scale2sheet4go/internal/sources/googlefit"
	"github.com/kappaseijin/scale2sheet4go/internal/sources/scaleexporter"
)

const AppVersion = "0.1.0"

type Output struct {
	Out io.Writer
	Err io.Writer
}

func (o Output) out() io.Writer {
	if o.Out == nil {
		return io.Discard
	}
	return o.Out
}
func (o Output) err() io.Writer {
	if o.Err == nil {
		return io.Discard
	}
	return o.Err
}

func Run(ctx context.Context, invocation Invocation, output Output) int {
	if invocation.Help {
		printHelp(output.out())
		return 0
	}
	if invocation.Version {
		fmt.Fprintln(output.out(), AppVersion)
		return 0
	}
	if ctx == nil {
		ctx = context.Background()
	}
	switch invocation.Command {
	case CommandPipeline:
		return runPipelineCommand(ctx, invocation, output)
	case CommandRun:
		return runMeasurementCommand(ctx, invocation, output)
	case CommandServe:
		return runServeCommand(ctx, invocation, output)
	case CommandInstall:
		return runInstallCommand(ctx, invocation, output)
	case CommandUninstall:
		return runUninstallCommand(ctx, invocation, output)
	case CommandDoctor:
		return runDoctorCommand(invocation, output)
	case CommandAuth:
		return runAuthCommand(ctx, invocation, output)
	default:
		fmt.Fprintf(output.err(), "%s: command is not implemented\n", invocation.Command)
		return 1
	}
}

func runPipelineCommand(ctx context.Context, invocation Invocation, output Output) int {
	env := environment()
	appConfig, err := config.Load("", env)
	if err != nil {
		return printRuntimeError(output, err)
	}
	if _, err := config.RequireGoogleSheetsConfig(appConfig); err != nil {
		return printRuntimeError(output, err)
	}
	sourceConfig, err := config.RequireScaleExporterConfig(appConfig)
	if err != nil {
		return printRuntimeError(output, err)
	}
	zone, err := loadTimeZone(appConfig.TimeZone)
	if err != nil {
		return printRuntimeError(output, err)
	}
	referenceTime, targetDate, err := referenceForDate(invocation.Date, zone)
	if err != nil {
		return printRuntimeError(output, err)
	}
	period := toDomainPeriod(invocation.Period)
	configDir := filepath.Join(homeDirectory(), ".config", "scale2sheet")
	statusPath := filepath.Join(configDir, "pipeline-status.json")
	lease, err := scheduler.AcquireRunLease(scheduler.AcquireOptions{ConfigDir: configDir, Kind: "pipeline", Origin: launchdOrigin(), Period: string(invocation.Period)})
	if err != nil {
		return printRuntimeError(output, err)
	}
	defer lease.Release()
	statusWriter := pipeline.NewAtomicPipelineStatusWriter(statusPath, lease.OwnerToken())
	result, err := pipeline.Run(ctx, pipeline.RunOptions{
		Period: period, ReferenceTime: referenceTime, TimeZone: zone, TargetDate: targetDate,
		ReadInput: func() (pipeline.StableInputSnapshot, error) {
			return pipeline.ReadStableInputSnapshot(pipeline.ReadStableInputSnapshotOptions{OutputDir: sourceConfig.OutputDir, TargetDate: targetDate})
		},
		Transfer:     transferReadings(ctx, appConfig, period, referenceTime, zone),
		StatusWriter: statusWriter,
		Notifier:     pipeline.NewMacOSNotifier(os.Getenv("SCALE2SHEET_OSASCRIPT_PATH")),
	})
	if err != nil {
		return printRuntimeError(output, err)
	}
	fmt.Fprintln(output.out(), result.Outcome)
	return result.ExitCode
}

func runMeasurementCommand(ctx context.Context, invocation Invocation, output Output) int {
	env := environment()
	appConfig, err := config.Load("", env)
	if err != nil {
		return printRuntimeError(output, err)
	}
	sheetsConfig, err := config.RequireGoogleSheetsConfig(appConfig)
	if err != nil {
		return printRuntimeError(output, err)
	}
	source := invocation.Source
	if source == "" {
		source = Source(appConfig.DefaultSource)
	}
	zone, err := loadTimeZone(appConfig.TimeZone)
	if err != nil {
		return printRuntimeError(output, err)
	}
	referenceTime, _, err := referenceForDate(invocation.Date, zone)
	if err != nil {
		return printRuntimeError(output, err)
	}
	period := toDomainPeriod(invocation.Period)
	readings, err := readSource(ctx, appConfig, source, referenceTime, zone)
	if err != nil {
		return printRuntimeError(output, err)
	}
	filtered := service.FilterReadingsByPeriodWindow(readings, period, referenceTime, zone)
	latest := service.BuildLatestMeasurementSet(filtered, period, referenceTime.UTC().Format(time.RFC3339Nano))
	if latest.WeightKg == nil {
		fmt.Fprintln(output.out(), "No spreadsheet row updated.")
		return 0
	}
	client, err := sheets.NewGoogleSheetsClient(ctx, sheetsConfig.ApplicationCredentialsPath)
	if err != nil {
		return printRuntimeError(output, err)
	}
	transfer, err := service.TransferLatestMeasurementSet(ctx, client, latest, *sheetsConfig, zone)
	if err != nil {
		return printRuntimeError(output, err)
	}
	if transfer.Row == nil {
		fmt.Fprintln(output.out(), "No spreadsheet row updated.")
		return 0
	}
	encoded := fmt.Sprintf(`{"date":%q,"time":%q,"periodLabel":%q,"source":%q}`, transfer.Row.Date, transfer.Row.Time, transfer.Row.PeriodLabel, transfer.Row.Source)
	fmt.Fprintln(output.out(), encoded)
	return 0
}

func runServeCommand(ctx context.Context, invocation Invocation, output Output) int {
	appConfig, err := config.Load("", environment())
	if err != nil {
		return printRuntimeError(output, err)
	}
	if _, err := config.RequireGoogleSheetsConfig(appConfig); err != nil {
		return printRuntimeError(output, err)
	}
	selectedSource := invocation.Source
	if selectedSource == "" {
		selectedSource = Source(appConfig.DefaultSource)
	}
	if _, err := requireSourceConfig(appConfig, selectedSource); err != nil {
		return printRuntimeError(output, err)
	}
	zone, err := loadTimeZone(appConfig.TimeZone)
	if err != nil {
		return printRuntimeError(output, err)
	}
	configDir := filepath.Join(homeDirectory(), ".config", "scale2sheet")
	lease, err := scheduler.AcquireRunLease(scheduler.AcquireOptions{ConfigDir: configDir, Kind: "serve", Origin: launchdOrigin()})
	if err != nil {
		return printRuntimeError(output, err)
	}
	defer lease.Release()
	serveCtx, cancel := signal.NotifyContext(ctx, syscall.SIGTERM, syscall.SIGINT)
	defer cancel()
	lease.StartStopPolling(cancel)
	logger := &writerLogger{output: output}
	err = scheduler.RunServe(serveCtx, scheduler.SchedulerConfig{MorningCron: appConfig.Scheduler.MorningCron, EveningCron: appConfig.Scheduler.EveningCron, TimeZone: zone}, func(runCtx context.Context, period string) error {
		periodValue := Period(period)
		return executeOneRun(runCtx, appConfig, selectedSource, periodValue, time.Now(), zone, output)
	}, logger)
	if errors.Is(err, context.Canceled) {
		return 0
	}
	if err != nil {
		return printRuntimeError(output, err)
	}
	return 0
}

func executeOneRun(ctx context.Context, appConfig config.AppConfig, source Source, period Period, referenceTime time.Time, zone *time.Location, output Output) error {
	readings, err := readSource(ctx, appConfig, source, referenceTime, zone)
	if err != nil {
		return err
	}
	filtered := service.FilterReadingsByPeriodWindow(readings, toDomainPeriod(period), referenceTime, zone)
	latest := service.BuildLatestMeasurementSet(filtered, toDomainPeriod(period), referenceTime.UTC().Format(time.RFC3339Nano))
	sheetsConfig, err := config.RequireGoogleSheetsConfig(appConfig)
	if err != nil {
		return err
	}
	client, err := sheets.NewGoogleSheetsClient(ctx, sheetsConfig.ApplicationCredentialsPath)
	if err != nil {
		return err
	}
	result, err := service.TransferLatestMeasurementSet(ctx, client, latest, *sheetsConfig, zone)
	if err != nil {
		return err
	}
	if result.Row == nil {
		fmt.Fprintf(output.out(), "No %s spreadsheet row updated.\n", period)
	} else {
		fmt.Fprintf(output.out(), "Updated %s row: %s %s (%s)\n", period, result.Row.Date, result.Row.Time, result.Row.Source)
	}
	return nil
}

func runInstallCommand(_ context.Context, invocation Invocation, output Output) int {
	home := homeDirectory()
	prefix := invocation.Prefix
	if prefix == "" {
		prefix = "~/.local"
	}
	paths, err := installation.ResolvePaths(home, prefix)
	if err != nil {
		return printRuntimeError(output, err)
	}
	settingsExists := fileExists(paths.SettingsPath)
	if invocation.Launchd {
		ready, issues := installation.LaunchdReady(paths.SettingsPath, paths.ConfigDir)
		if !ready {
			fmt.Fprintln(output.err(), "failed:launchd-not-ready")
			for _, issue := range issues {
				fmt.Fprintln(output.err(), issue)
			}
			fmt.Fprintf(output.err(), "settings: %s\n", paths.SettingsPath)
			return 1
		}
	}
	if settingsExists {
		missing, missingErr := installation.MissingAuthFiles(paths.SettingsPath, paths.ConfigDir)
		if missingErr != nil {
			return printRuntimeError(output, missingErr)
		}
		if len(missing) > 0 {
			fmt.Fprintf(output.err(), "failed:missing-auth-files %s\n", strings.Join(missing, ", "))
			return 1
		}
	}
	binarySource, err := os.Executable()
	if err != nil {
		return printRuntimeError(output, err)
	}
	operations := installation.PlanInstall(paths, invocation.Launchd, settingsExists, binarySource)
	if invocation.DryRun {
		for _, operation := range operations {
			fmt.Fprintln(output.out(), "[planned] "+installation.DescribeOperation(operation))
		}
		return 0
	}
	var lease *scheduler.LeaseHandle
	if invocation.Launchd {
		lease, err = scheduler.AcquireRunLease(scheduler.AcquireOptions{ConfigDir: paths.ConfigDir, Kind: "maintenance", Origin: "maintenance"})
		if err != nil {
			return printRuntimeError(output, err)
		}
		defer lease.Release()
	}
	if err := os.MkdirAll(paths.ConfigDir, 0o700); err != nil {
		return printRuntimeError(output, err)
	}
	manifest, err := installation.ReadManifest(paths.ManifestPath)
	if err != nil {
		return printRuntimeError(output, err)
	}
	if manifest == nil {
		initial := installation.MakeInstallingManifest(paths, invocation.Launchd)
		if err := installation.WriteManifest(paths.ManifestPath, initial); err != nil {
			return printRuntimeError(output, err)
		}
		manifest = &initial
	} else if manifest.State != installation.ManifestInstalling {
		next := *manifest
		next.State = installation.ManifestInstalling
		next.UpdatedAt = time.Now().UTC().Format("2006-01-02T15:04:05.000Z")
		if err := installation.WriteManifest(paths.ManifestPath, next); err != nil {
			return printRuntimeError(output, err)
		}
		manifest = &next
	}
	failed, pending := installation.ApplyOperations(operations, paths.ManifestPath, func(message string) { fmt.Fprintln(output.out(), message) })
	if failed != "" {
		fmt.Fprintf(output.err(), "failed: %s\n", failed)
		for _, step := range pending {
			fmt.Fprintf(output.err(), "pending: %s\n", step)
		}
		return 1
	}
	finished, _ := installation.ReadManifest(paths.ManifestPath)
	if finished != nil {
		next := *finished
		next.State = installation.ManifestInstalled
		next.Version = installation.InstallVersion
		next.CreatedPaths = uniquePaths([]string{paths.ConfigDir, paths.BinDir, paths.LogDir})
		if invocation.Launchd {
			next.Launchd = &installation.ManifestLaunchd{Enabled: true, Domain: "gui/" + fmt.Sprint(os.Getuid()), Labels: []string{installation.LaunchdLabelPrefix + ".morning", installation.LaunchdLabelPrefix + ".evening"}, PlistPaths: []string{paths.MorningPlistPath, paths.EveningPlistPath}}
		}
		next.UpdatedAt = time.Now().UTC().Format("2006-01-02T15:04:05.000Z")
		if err := installation.WriteManifest(paths.ManifestPath, next); err != nil {
			return printRuntimeError(output, err)
		}
	}
	fmt.Fprintf(output.out(), "installed %s\n", paths.BinaryPath)
	return 0
}

func runUninstallCommand(_ context.Context, invocation Invocation, output Output) int {
	home := homeDirectory()
	prefix := invocation.Prefix
	if prefix == "" {
		prefix = "~/.local"
	}
	paths, err := installation.ResolvePaths(home, prefix)
	if err != nil {
		return printRuntimeError(output, err)
	}
	manifest, err := installation.ReadManifest(paths.ManifestPath)
	if err != nil {
		return printRuntimeError(output, err)
	}
	if manifest == nil {
		fmt.Fprintln(output.out(), "nothing to do")
		return 0
	}
	operations := installation.PlanUninstall(manifest)
	if invocation.DryRun {
		for _, operation := range operations {
			fmt.Fprintln(output.out(), "[planned] "+installation.DescribeOperation(operation))
		}
		return 0
	}
	lease, err := scheduler.AcquireRunLease(scheduler.AcquireOptions{ConfigDir: manifest.ConfigDir, Kind: "maintenance", Origin: "maintenance"})
	if err != nil {
		return printRuntimeError(output, err)
	}
	defer lease.Release()
	next := *manifest
	next.State = installation.ManifestUninstalling
	next.UpdatedAt = time.Now().UTC().Format("2006-01-02T15:04:05.000Z")
	if err := installation.WriteManifest(manifest.ConfigDir+"/install-manifest.json", next); err != nil {
		return printRuntimeError(output, err)
	}
	failed, pending := installation.ApplyOperations(operations, manifest.ConfigDir+"/install-manifest.json", func(message string) { fmt.Fprintln(output.out(), message) })
	if failed != "" {
		fmt.Fprintf(output.err(), "failed: %s\n", failed)
		for _, step := range pending {
			fmt.Fprintf(output.err(), "pending: %s\n", step)
		}
		return 1
	}
	fmt.Fprintf(output.out(), "uninstalled %s\n", manifest.BinaryPath)
	fmt.Fprintln(output.out(), "settings, auth files, and logs remain at:")
	fmt.Fprintln(output.out(), "  "+manifest.ConfigDir)
	return 0
}

func runDoctorCommand(_ Invocation, output Output) int {
	home := homeDirectory()
	paths, err := installation.ResolvePaths(home, "~/.local")
	if err != nil {
		return printRuntimeError(output, err)
	}
	failures := 0
	check := func(id string, status string, message string) {
		fmt.Fprintf(output.out(), "[%s] %s: %s\n", status, id, message)
		switch status {
		case "FAIL":
			failures++
		}
	}

	manifest, manifestErr := installation.ReadManifest(paths.ManifestPath)
	switch {
	case manifestErr != nil:
		check("manifest", "FAIL", manifestErr.Error())
	case manifest == nil:
		check("manifest", "WARN", "not installed: no install manifest found")
	default:
		check("manifest", "PASS", fmt.Sprintf("state=%s version=%s", manifest.State, manifest.Version))
		if executable, executableErr := os.Executable(); executableErr == nil && filepath.Clean(executable) != filepath.Clean(manifest.BinaryPath) {
			check("binary-placement", "FAIL", fmt.Sprintf("running binary %s does not match manifest path %s", executable, manifest.BinaryPath))
		} else if executableErr != nil {
			check("binary-placement", "WARN", "cannot resolve running binary: "+executableErr.Error())
		} else {
			check("binary-placement", "PASS", manifest.BinaryPath)
		}
		if info, statErr := os.Stat(manifest.BinaryPath); statErr != nil || info == nil || info.Mode()&0o111 == 0 {
			check("binary-executable", "FAIL", manifest.BinaryPath+" is missing or not executable")
		} else {
			check("binary-executable", "PASS", manifest.BinaryPath)
		}
		if manifest.Version != installation.InstallVersion || installation.InstallVersion != AppVersion {
			check("binary-version", "FAIL", fmt.Sprintf("manifest version %s does not match %s", manifest.Version, AppVersion))
		} else {
			check("binary-version", "PASS", "version "+AppVersion)
		}
	}

	settings, settingsErr := readSettingsForDoctor(paths.SettingsPath)
	switch {
	case settingsErr != nil:
		check("settings", "FAIL", settingsErr.Error())
	case settings == nil:
		check("settings", "WARN", "no settings.json found")
	default:
		check("settings", "PASS", "settings.json parses and validates")
		checkDoctorFile(check, "sheets-key-file", resolveConfiguredPath(settings.SheetsCredentials, filepath.Join(paths.ConfigDir, "google-sheets-service-account.json")))
		source := "scale-exporter"
		if settings.Source != nil {
			source = strings.TrimSpace(*settings.Source)
		}
		switch source {
		case "scale-exporter":
			checkDoctorFile(check, "scale-exporter-output-dir", resolveConfiguredPath(settings.ScaleExporterOutputDir, ""))
		case "apple-health":
			checkDoctorFile(check, "apple-health-export", resolveConfiguredPath(settings.AppleHealthExportXML, ""))
		case "google-fit":
			clientID, clientSecret := configuredGoogleFitCredentials(*settings, paths.ConfigDir)
			if clientID == "" || clientSecret == "" {
				check("source-auth-file", "FAIL", "google-fit client credentials are not configured")
			} else {
				check("source-auth-file", "PASS", "google-fit client credentials are configured")
			}
			checkDoctorFile(check, "google-fit-token", resolveConfiguredPath(settings.GoogleFitTokenPath, filepath.Join(paths.ConfigDir, "google-fit-token.json")))
		default:
			check("source", "FAIL", "unsupported source: "+source)
		}
	}

	plistCount := 0
	for _, plistPath := range []string{paths.MorningPlistPath, paths.EveningPlistPath} {
		data, readErr := os.ReadFile(plistPath)
		if errors.Is(readErr, os.ErrNotExist) {
			continue
		}
		plistCount++
		if readErr != nil || !strings.Contains(string(data), "<plist") || !strings.Contains(string(data), "<key>ProgramArguments</key>") {
			check("plist-syntax", "FAIL", plistPath+" is missing or malformed")
		} else {
			check("plist-syntax", "PASS", plistPath)
		}
	}
	if plistCount == 0 {
		check("plist-syntax", "WARN", "no launchd plist files found")
	}

	if receipt := scheduler.ReadActiveRunReceipt(paths.ConfigDir); receipt != nil {
		fmt.Fprintf(output.out(), "[PASS] active-run: %s pid=%d\n", receipt.Kind, receipt.PID)
	} else {
		fmt.Fprintln(output.out(), "[PASS] active-run: no active run")
	}
	status, statusErr := pipeline.ReadPipelineStatusDocument(paths.PipelineStatusPath)
	if statusErr != nil {
		check("pipeline-status", "FAIL", statusErr.Error())
	} else if status == nil {
		check("pipeline-status", "WARN", "no pipeline-status.json found")
	} else {
		check("pipeline-status", "PASS", fmt.Sprintf("schema=%d definitions=%d", status.SchemaVersion, status.DefinitionsVersion))
	}
	return boolExit(failures == 0)
}

func readSettingsForDoctor(path string) (*config.SettingsFile, error) {
	data, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	settings, err := config.ParseSettingsFile(data, path)
	if err != nil {
		return nil, err
	}
	return &settings, nil
}

func resolveConfiguredPath(value *string, fallback string) string {
	if value == nil || strings.TrimSpace(*value) == "" {
		return fallback
	}
	return config.ExpandHomePath(strings.TrimSpace(*value), homeDirectory())
}

func checkDoctorFile(check func(string, string, string), id, path string) {
	if path == "" {
		check(id, "WARN", "not configured")
		return
	}
	info, err := os.Stat(path)
	if err != nil || info == nil {
		check(id, "FAIL", path+" is missing or unreadable")
		return
	}
	check(id, "PASS", path)
}

func configuredGoogleFitCredentials(settings config.SettingsFile, configDir string) (string, string) {
	clientID, clientSecret := "", ""
	if settings.GoogleFitClientID != nil {
		clientID = strings.TrimSpace(*settings.GoogleFitClientID)
	}
	if settings.GoogleFitClientSecret != nil {
		clientSecret = strings.TrimSpace(*settings.GoogleFitClientSecret)
	}
	if clientID != "" && clientSecret != "" {
		return clientID, clientSecret
	}
	credentials, err := config.LoadGoogleFitCredentials(configDir)
	if err != nil || credentials == nil {
		return "", ""
	}
	return credentials.ClientID, credentials.ClientSecret
}

func runAuthCommand(ctx context.Context, _ Invocation, output Output) int {
	appConfig, err := config.Load("", environment())
	if err != nil {
		return printRuntimeError(output, err)
	}
	settings, err := config.RequireGoogleFitConfig(appConfig)
	if err != nil {
		return printRuntimeError(output, err)
	}
	options := auth.GoogleFitAuthOptions{
		Log: func(message string) { fmt.Fprintln(output.out(), message) },
	}
	if runtime.GOOS == "darwin" {
		options.OpenBrowser = func(authURL string) error {
			return exec.CommandContext(ctx, "open", authURL).Run()
		}
	}
	if err := auth.RunGoogleFitAuth(ctx, *settings, options); err != nil {
		return printRuntimeError(output, err)
	}
	return 0
}

func transferReadings(ctx context.Context, appConfig config.AppConfig, period domain.MeasurementPeriod, referenceTime time.Time, zone *time.Location) func([]domain.MeasurementReading) (domain.TransferOutcome, error) {
	return func(readings []domain.MeasurementReading) (domain.TransferOutcome, error) {
		sheetsConfig, err := config.RequireGoogleSheetsConfig(appConfig)
		if err != nil {
			return domain.TransferOutcome{}, err
		}
		latest := service.BuildLatestMeasurementSet(readings, period, referenceTime.UTC().Format(time.RFC3339Nano))
		client, err := sheets.NewGoogleSheetsClient(ctx, sheetsConfig.ApplicationCredentialsPath)
		if err != nil {
			return domain.TransferOutcome{}, err
		}
		result, err := service.TransferLatestMeasurementSet(ctx, client, latest, *sheetsConfig, zone)
		if err != nil {
			return domain.TransferOutcome{}, err
		}
		return result.Outcome, nil
	}
}

func readSource(ctx context.Context, appConfig config.AppConfig, source Source, referenceTime time.Time, zone *time.Location) ([]domain.MeasurementReading, error) {
	switch source {
	case SourceScaleExporter:
		value, err := config.RequireScaleExporterConfig(appConfig)
		if err != nil {
			return nil, err
		}
		return scaleexporter.ReadMeasurements(scaleexporter.Config{OutputDir: value.OutputDir}, referenceTime, zone)
	case SourceAppleHealth:
		value, err := config.RequireAppleHealthConfig(appConfig)
		if err != nil {
			return nil, err
		}
		return applehealth.ReadMeasurements(applehealth.Config{ExportXMLPath: value.ExportXMLPath})
	case SourceGoogleFit:
		value, err := config.RequireGoogleFitConfig(appConfig)
		if err != nil {
			return nil, err
		}
		return googlefit.ReadMeasurements(ctx, *value, referenceTime)
	default:
		return nil, fmt.Errorf("source %s is not supported by the Go reader", source)
	}
}

func requireSourceConfig(appConfig config.AppConfig, source Source) (bool, error) {
	switch source {
	case SourceScaleExporter:
		_, err := config.RequireScaleExporterConfig(appConfig)
		return err == nil, err
	case SourceAppleHealth:
		_, err := config.RequireAppleHealthConfig(appConfig)
		return err == nil, err
	case SourceGoogleFit:
		_, err := config.RequireGoogleFitConfig(appConfig)
		return err == nil, err
	default:
		return false, fmt.Errorf("unknown source %s", source)
	}
}

func referenceForDate(date string, zone *time.Location) (time.Time, string, error) {
	if date == "" {
		now := time.Now()
		return now, now.In(zone).Format("2006-01-02"), nil
	}
	parsed, err := time.ParseInLocation("2006-01-02", date, zone)
	if err != nil {
		return time.Time{}, "", &ArgumentError{Message: "date must be a valid YYYY-MM-DD date"}
	}
	end := time.Date(parsed.Year(), parsed.Month(), parsed.Day(), 23, 59, 59, int(time.Second-time.Nanosecond), zone)
	return end, date, nil
}
func loadTimeZone(name string) (*time.Location, error) {
	if strings.TrimSpace(name) == "" {
		return time.UTC, nil
	}
	return time.LoadLocation(name)
}
func toDomainPeriod(period Period) domain.MeasurementPeriod {
	if period == PeriodEvening {
		return domain.PeriodEvening
	}
	return domain.PeriodMorning
}
func environment() map[string]string {
	result := make(map[string]string)
	for _, value := range os.Environ() {
		if key, val, ok := strings.Cut(value, "="); ok {
			result[key] = val
		}
	}
	return result
}
func homeDirectory() string {
	if value := os.Getenv("HOME"); value != "" {
		return value
	}
	value, _ := os.UserHomeDir()
	return value
}
func fileExists(path string) bool { _, err := os.Stat(path); return err == nil }
func printRuntimeError(output Output, err error) int {
	fmt.Fprintln(output.err(), err)
	return ExitCode(err)
}
func boolExit(value bool) int {
	if value {
		return 0
	}
	return 1
}
func uniquePaths(values []string) []string {
	seen := map[string]bool{}
	result := []string{}
	for _, value := range values {
		if !seen[value] {
			seen[value] = true
			result = append(result, value)
		}
	}
	return result
}
func launchdOrigin() string {
	if os.Getenv("SCALE2SHEET_LAUNCHD_LABEL") != "" {
		return "launchd"
	}
	return "manual"
}

type writerLogger struct{ output Output }

func (l *writerLogger) Log(message string) { fmt.Fprintln(l.output.out(), message) }
func (l *writerLogger) Error(err error)    { fmt.Fprintln(l.output.err(), err) }

func printHelp(writer io.Writer) {
	fmt.Fprint(writer, `Usage: scale2sheet <command> [options]

Commands:
  auth       Run the Google Fit OAuth flow.
  doctor     Inspect the installed runtime.
  install    Install the scale2sheet binary and settings.
  pipeline   Transfer a stable scale-exporter snapshot.
  run        Transfer the latest measurements.
  serve      Run morning/evening schedules.
  uninstall  Remove the installed runtime.

Options:
  --help     Show this help.
  --version  Show the version.
`)
}
