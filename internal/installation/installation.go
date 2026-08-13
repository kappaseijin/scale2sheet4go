package installation

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"syscall"
	"time"

	"github.com/kappaseijin/scale2sheet4go/internal/config"
)

const (
	LaunchdLabelPrefix = "jp.seijin.kappa.scale-pipeline"
	InstallVersion     = "0.1.0"
)

var deniedPrefixes = []string{"/", "/usr", "/bin", "/sbin", "/etc", "/System", "/Library"}

type Paths struct {
	Home, Prefix, BinDir, BinaryPath                                             string
	ConfigDir, SettingsPath, ManifestPath, ActiveRunPath, PipelineStatusPath     string
	LaunchAgentsDir, MorningPlistPath, EveningPlistPath                          string
	LogDir, MorningLogPath, MorningErrLogPath, EveningLogPath, EveningErrLogPath string
}

func NormalizePath(value, home string) string {
	if value == "~" {
		value = home
	} else if strings.HasPrefix(value, "~/") {
		value = filepath.Join(home, value[2:])
	}
	absolute, err := filepath.Abs(value)
	if err != nil {
		return filepath.Clean(value)
	}
	return filepath.Clean(absolute)
}

func ResolvePaths(home, prefix string) (Paths, error) {
	home = NormalizePath(home, home)
	prefix = NormalizePath(prefix, home)
	for _, denied := range deniedPrefixes {
		if prefix == denied || prefix == home {
			return Paths{}, fmt.Errorf("refusing to install under dangerous prefix: %s", prefix)
		}
	}
	binDir := filepath.Join(prefix, "bin")
	configDir := filepath.Join(home, ".config", "scale2sheet")
	launchAgentsDir := filepath.Join(home, "Library", "LaunchAgents")
	logDir := filepath.Join(home, "Library", "Logs", "scale-pipeline")
	return Paths{
		Home: home, Prefix: prefix, BinDir: binDir, BinaryPath: filepath.Join(binDir, "scale2sheet"),
		ConfigDir: configDir, SettingsPath: filepath.Join(configDir, "settings.json"), ManifestPath: filepath.Join(configDir, "install-manifest.json"),
		ActiveRunPath: filepath.Join(configDir, "active-run.json"), PipelineStatusPath: filepath.Join(configDir, "pipeline-status.json"),
		LaunchAgentsDir: launchAgentsDir, MorningPlistPath: filepath.Join(launchAgentsDir, LaunchdLabelPrefix+".morning.plist"), EveningPlistPath: filepath.Join(launchAgentsDir, LaunchdLabelPrefix+".evening.plist"),
		LogDir: logDir, MorningLogPath: filepath.Join(logDir, "morning.log"), MorningErrLogPath: filepath.Join(logDir, "morning.err.log"), EveningLogPath: filepath.Join(logDir, "evening.log"), EveningErrLogPath: filepath.Join(logDir, "evening.err.log"),
	}, nil
}

type ManifestState string

const (
	ManifestInstalling   ManifestState = "installing"
	ManifestInstalled    ManifestState = "installed"
	ManifestUninstalling ManifestState = "uninstalling"
)

type ManifestLaunchd struct {
	Enabled    bool     `json:"enabled"`
	Domain     string   `json:"domain"`
	Labels     []string `json:"labels"`
	PlistPaths []string `json:"plist-paths"`
}

type Manifest struct {
	SchemaVersion int              `json:"schema-version"`
	State         ManifestState    `json:"state"`
	Version       string           `json:"version"`
	Prefix        string           `json:"prefix"`
	BinaryPath    string           `json:"binary-path"`
	ConfigDir     string           `json:"config-dir"`
	LogDir        string           `json:"log-dir"`
	Launchd       *ManifestLaunchd `json:"launchd,omitempty"`
	AppliedSteps  []string         `json:"applied-steps"`
	CreatedPaths  []string         `json:"created-paths"`
	UpdatedAt     string           `json:"updated-at"`
}

func ReadManifest(path string) (*Manifest, error) {
	data, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var manifest Manifest
	if err := json.Unmarshal(data, &manifest); err != nil {
		return nil, fmt.Errorf("install manifest is not valid JSON: %w", err)
	}
	if manifest.SchemaVersion != 1 || manifest.Version == "" || manifest.BinaryPath == "" || manifest.ConfigDir == "" || manifest.LogDir == "" || manifest.AppliedSteps == nil || manifest.CreatedPaths == nil || manifest.UpdatedAt == "" {
		return nil, errors.New("install manifest has an invalid schema")
	}
	if manifest.State != ManifestInstalling && manifest.State != ManifestInstalled && manifest.State != ManifestUninstalling {
		return nil, errors.New("install manifest has an invalid state")
	}
	return &manifest, nil
}

func WriteManifest(path string, manifest Manifest) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}
	current, err := ReadManifest(path)
	if err != nil {
		return err
	}
	if !legalTransition(nil, manifest.State) && current == nil {
		return fmt.Errorf("illegal manifest transition: (none) -> %s", manifest.State)
	}
	if current != nil && !legalTransition(statePointer(current.State), manifest.State) {
		return fmt.Errorf("illegal manifest transition: %s -> %s", current.State, manifest.State)
	}
	data, err := json.MarshalIndent(manifest, "", "  ")
	if err != nil {
		return err
	}
	data = append(data, '\n')
	temporary := fmt.Sprintf("%s.%d.tmp", path, os.Getpid())
	if err := os.WriteFile(temporary, data, 0o600); err != nil {
		return err
	}
	if err := os.Chmod(temporary, 0o600); err != nil {
		_ = os.Remove(temporary)
		return err
	}
	if err := os.Rename(temporary, path); err != nil {
		_ = os.Remove(temporary)
		return err
	}
	return nil
}

func statePointer(value ManifestState) *ManifestState { return &value }

func legalTransition(from *ManifestState, to ManifestState) bool {
	if from == nil {
		return to == ManifestInstalling
	}
	switch {
	case *from == ManifestInstalling && (to == ManifestInstalling || to == ManifestInstalled):
		return true
	case *from == ManifestInstalled && (to == ManifestInstalling || to == ManifestUninstalling):
		return true
	case *from == ManifestUninstalling && to == ManifestUninstalling:
		return true
	default:
		return false
	}
}

type PlistTime struct{ Hour, Minute int }

func BuildPipelinePlist(label, binaryPath, period, stdoutPath, stderrPath, home, binDir string, times []PlistTime) string {
	xml := func(value string) string {
		value = strings.ReplaceAll(value, "&", "&amp;")
		value = strings.ReplaceAll(value, "<", "&lt;")
		value = strings.ReplaceAll(value, ">", "&gt;")
		value = strings.ReplaceAll(value, `"`, "&quot;")
		return strings.ReplaceAll(value, "'", "&apos;")
	}
	intervals := strings.Builder{}
	for _, value := range times {
		fmt.Fprintf(&intervals, "<dict><key>Hour</key><integer>%d</integer><key>Minute</key><integer>%d</integer></dict>", value.Hour, value.Minute)
	}
	pathValue := strings.Join(uniqueStrings([]string{binDir, "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin", "/usr/sbin", "/sbin"}), ":")
	return fmt.Sprintf(`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key><string>%s</string>
    <key>ProgramArguments</key>
    <array><string>%s</string><string>pipeline</string><string>--period</string><string>%s</string></array>
    <key>StartCalendarInterval</key>
    <array>%s</array>
    <key>StandardOutPath</key><string>%s</string>
    <key>StandardErrorPath</key><string>%s</string>
    <key>EnvironmentVariables</key>
    <dict><key>HOME</key><string>%s</string><key>PATH</key><string>%s</string><key>SCALE2SHEET_LAUNCHD_LABEL</key><string>%s</string></dict>
</dict>
</plist>
`, xml(label), xml(binaryPath), period, intervals.String(), xml(stdoutPath), xml(stderrPath), xml(home), xml(pathValue), xml(label))
}

func uniqueStrings(values []string) []string {
	seen := map[string]bool{}
	result := make([]string, 0, len(values))
	for _, value := range values {
		if !seen[value] {
			seen[value] = true
			result = append(result, value)
		}
	}
	return result
}

type Operation struct {
	Kind      string
	Path      string
	Source    string
	Target    string
	Label     string
	Domain    string
	PlistPath string
	XML       string
	Mode      os.FileMode
}

func DescribeOperation(operation Operation) string {
	switch operation.Kind {
	case "ensure-directory":
		return "ensure-directory " + operation.Path
	case "ensure-settings":
		return "ensure-settings " + operation.Path
	case "replace-binary":
		return "replace-binary " + operation.Target
	case "write-plist":
		return "write-plist " + operation.Label
	case "acquire-maintenance-lease":
		return "acquire-maintenance-lease " + operation.Path
	case "bootout":
		return "bootout " + operation.Label
	case "bootstrap":
		return "bootstrap " + operation.PlistPath
	case "remove-file":
		return "remove-file " + operation.Path
	case "remove-tree":
		return "remove-tree " + operation.Path
	default:
		return operation.Kind
	}
}

func PlanInstall(paths Paths, launchd, settingsExists bool, binarySource string) []Operation {
	operations := []Operation{{Kind: "ensure-directory", Path: paths.ConfigDir, Mode: 0o700}}
	if !settingsExists {
		operations = append(operations, Operation{Kind: "ensure-settings", Path: paths.SettingsPath})
	}
	operations = append(operations, Operation{Kind: "ensure-directory", Path: paths.BinDir, Mode: 0o755}, Operation{Kind: "ensure-directory", Path: paths.LogDir, Mode: 0o700}, Operation{Kind: "replace-binary", Source: binarySource, Target: paths.BinaryPath})
	if launchd {
		domain := "gui/" + fmt.Sprint(os.Getuid())
		for _, value := range []struct {
			period, plist, stdout, stderr string
			times                         []PlistTime
		}{{"morning", paths.MorningPlistPath, paths.MorningLogPath, paths.MorningErrLogPath, []PlistTime{{7, 0}, {11, 30}}}, {"evening", paths.EveningPlistPath, paths.EveningLogPath, paths.EveningErrLogPath, []PlistTime{{21, 0}, {23, 30}}}} {
			label := LaunchdLabelPrefix + "." + value.period
			operations = append(operations, Operation{Kind: "bootout", Domain: domain, Label: label}, Operation{Kind: "write-plist", Label: label, Path: value.plist, XML: BuildPipelinePlist(label, paths.BinaryPath, value.period, value.stdout, value.stderr, paths.Home, paths.BinDir, value.times)}, Operation{Kind: "bootstrap", Domain: domain, PlistPath: value.plist})
		}
	}
	return operations
}

func PlanUninstall(manifest *Manifest) []Operation {
	if manifest == nil {
		return nil
	}
	operations := []Operation{}
	if manifest.Launchd != nil {
		for _, label := range manifest.Launchd.Labels {
			operations = append(operations, Operation{Kind: "bootout", Domain: manifest.Launchd.Domain, Label: label})
		}
		for _, path := range manifest.Launchd.PlistPaths {
			operations = append(operations, Operation{Kind: "remove-file", Path: path})
		}
	}
	binDir := filepath.Dir(manifest.BinaryPath)
	for _, path := range manifest.CreatedPaths {
		if path != manifest.ConfigDir && path != binDir {
			operations = append(operations, Operation{Kind: "remove-tree", Path: path})
		}
	}
	operations = append(operations, Operation{Kind: "remove-file", Path: filepath.Join(manifest.ConfigDir, "install-manifest.json")}, Operation{Kind: "remove-file", Path: manifest.BinaryPath})
	for _, path := range manifest.CreatedPaths {
		if path == binDir {
			operations = append(operations, Operation{Kind: "remove-tree", Path: binDir})
			break
		}
	}
	return operations
}

type InstallOptions struct {
	Prefix  string
	Launchd bool
	DryRun  bool
	Force   bool
}
type UninstallOptions struct {
	Prefix string
	DryRun bool
}

func EnsureSettings(path string) error {
	if _, err := os.Stat(path); err == nil {
		return nil
	}
	settings := config.DefaultSettingsContent(filepath.Dir(path))
	data, err := json.MarshalIndent(settings, "", "  ")
	if err != nil {
		return err
	}
	data = append(data, '\n')
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}
	return os.WriteFile(path, data, 0o600)
}

func MissingAuthFiles(settingsPath, configDir string) ([]string, error) {
	data, err := os.ReadFile(settingsPath)
	if errors.Is(err, os.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var settings config.SettingsFile
	if err := json.Unmarshal(data, &settings); err != nil {
		return nil, err
	}
	result := []string{}
	credentials := filepath.Join(configDir, "google-sheets-service-account.json")
	if settings.SheetsCredentials != nil && *settings.SheetsCredentials != "" {
		credentials = config.ExpandHomePath(*settings.SheetsCredentials, filepath.Dir(filepath.Dir(configDir)))
	}
	if _, err := os.Stat(credentials); errors.Is(err, os.ErrNotExist) {
		result = append(result, credentials)
	}
	if settings.Source != nil && strings.TrimSpace(*settings.Source) == "google-fit" {
		token := filepath.Join(configDir, "google-fit-token.json")
		if settings.GoogleFitTokenPath != nil && *settings.GoogleFitTokenPath != "" {
			token = config.ExpandHomePath(*settings.GoogleFitTokenPath, filepath.Dir(filepath.Dir(configDir)))
		}
		if _, err := os.Stat(token); errors.Is(err, os.ErrNotExist) {
			result = append(result, token)
		}
	}
	return result, nil
}

func LaunchdReady(settingsPath, configDir string) (bool, []string) {
	data, err := os.ReadFile(settingsPath)
	if errors.Is(err, os.ErrNotExist) {
		return false, []string{"settings-missing: " + settingsPath}
	}
	if err != nil {
		return false, []string{"settings-invalid: " + err.Error()}
	}
	var settings config.SettingsFile
	if err := json.Unmarshal(data, &settings); err != nil {
		return false, []string{"settings-invalid: " + err.Error()}
	}
	issues := []string{}
	if settings.SheetID == nil || strings.TrimSpace(*settings.SheetID) == "" || settings.SheetsCredentials == nil || strings.TrimSpace(*settings.SheetsCredentials) == "" {
		issues = append(issues, "sheets-config-missing")
	}
	source := "scale-exporter"
	if settings.Source != nil {
		source = strings.TrimSpace(*settings.Source)
	}
	switch source {
	case "scale-exporter":
		if settings.ScaleExporterOutputDir == nil || strings.TrimSpace(*settings.ScaleExporterOutputDir) == "" {
			issues = append(issues, "source-config-missing (scale-exporter)")
		}
	case "apple-health":
		if settings.AppleHealthExportXML == nil || strings.TrimSpace(*settings.AppleHealthExportXML) == "" {
			issues = append(issues, "source-config-missing (apple-health)")
		}
	case "google-fit":
		clientID := ""
		clientSecret := ""
		if settings.GoogleFitClientID != nil {
			clientID = strings.TrimSpace(*settings.GoogleFitClientID)
		}
		if settings.GoogleFitClientSecret != nil {
			clientSecret = strings.TrimSpace(*settings.GoogleFitClientSecret)
		}
		if clientID == "" || clientSecret == "" {
			credentials, credentialsErr := config.LoadGoogleFitCredentials(configDir)
			if credentialsErr != nil {
				issues = append(issues, "source-config-missing (google-fit): "+credentialsErr.Error())
			} else if credentials != nil {
				clientID, clientSecret = credentials.ClientID, credentials.ClientSecret
			}
		}
		if clientID == "" || clientSecret == "" {
			issues = append(issues, "source-config-missing (google-fit)")
		}
	default:
		issues = append(issues, "source-config-missing ("+source+")")
	}
	missing, _ := MissingAuthFiles(settingsPath, configDir)
	for _, path := range missing {
		issues = append(issues, "auth-file-missing: "+path)
	}
	return len(issues) == 0, issues
}

func ApplyOperations(operations []Operation, manifestPath string, logger func(string)) (failed string, pending []string) {
	for index, operation := range operations {
		step := DescribeOperation(operation)
		status := "done"
		var err error
		switch operation.Kind {
		case "ensure-directory":
			before := directoryExists(operation.Path)
			err = os.MkdirAll(operation.Path, operation.Mode)
			if before {
				status = "skipped"
			}
		case "ensure-settings":
			err = EnsureSettings(operation.Path)
		case "replace-binary":
			err = replaceBinary(operation.Source, operation.Target)
		case "write-plist":
			err = writePlist(operation.Path, operation.XML)
		case "bootout":
			if !launchdRegistered(operation.Domain, operation.Label) {
				status = "skipped"
			} else {
				err = launchctl("bootout", operation.Domain+"/"+operation.Label)
			}
		case "bootstrap":
			err = launchctl("bootstrap", operation.Domain, operation.PlistPath)
		case "remove-file":
			err = os.Remove(operation.Path)
			if errors.Is(err, os.ErrNotExist) {
				err = nil
				status = "skipped"
			}
		case "remove-tree":
			err = os.Remove(operation.Path)
			if errors.Is(err, os.ErrNotExist) || errors.Is(err, syscall.ENOTEMPTY) {
				err = nil
				status = "skipped"
			}
		}
		if err != nil {
			status = "failed"
		}
		if logger != nil {
			message := fmt.Sprintf("[%s] %s", status, step)
			if err != nil {
				message += ": " + err.Error()
			}
			logger(message)
		}
		if err != nil {
			for _, remaining := range operations[index+1:] {
				pending = append(pending, DescribeOperation(remaining))
			}
			return step, pending
		}
	}
	return "", nil
}

func directoryExists(path string) bool { info, err := os.Stat(path); return err == nil && info.IsDir() }

func replaceBinary(source, target string) error {
	temporary := filepath.Join(filepath.Dir(target), fmt.Sprintf(".scale2sheet.tmp-%d", os.Getpid()))
	if err := copyFile(source, temporary); err != nil {
		return err
	}
	defer os.Remove(temporary)
	if err := os.Chmod(temporary, 0o755); err != nil {
		return err
	}
	return os.Rename(temporary, target)
}

func copyFile(source, target string) error {
	input, err := os.Open(source)
	if err != nil {
		return err
	}
	defer input.Close()
	output, err := os.OpenFile(target, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o755)
	if err != nil {
		return err
	}
	defer output.Close()
	_, err = input.WriteTo(output)
	return err
}

func writePlist(path, xml string) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	temporary := path + fmt.Sprintf(".%d.tmp", os.Getpid())
	if err := os.WriteFile(temporary, []byte(xml), 0o644); err != nil {
		return err
	}
	return os.Rename(temporary, path)
}

func launchdRegistered(domain, label string) bool {
	return exec.Command("launchctl", "print", domain+"/"+label).Run() == nil
}
func launchctl(command string, args ...string) error {
	return exec.Command("launchctl", append([]string{command}, args...)...).Run()
}

func MakeInstallingManifest(paths Paths, launchd bool) Manifest {
	manifest := Manifest{SchemaVersion: 1, State: ManifestInstalling, Version: InstallVersion, Prefix: paths.Prefix, BinaryPath: paths.BinaryPath, ConfigDir: paths.ConfigDir, LogDir: paths.LogDir, AppliedSteps: []string{}, CreatedPaths: []string{}, UpdatedAt: time.Now().UTC().Format("2006-01-02T15:04:05.000Z")}
	if launchd {
		manifest.Launchd = &ManifestLaunchd{Enabled: true, Domain: "gui/" + fmt.Sprint(os.Getuid()), Labels: []string{}, PlistPaths: []string{}}
	}
	return manifest
}

func PlatformSupported() bool { return runtime.GOOS == "darwin" }
