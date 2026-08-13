package config

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

const DefaultSettingsPath = "~/.config/scale2sheet/settings.json"

type ConfigError struct {
	Message string
}

func (e *ConfigError) Error() string { return e.Message }

type SettingsFile struct {
	TimeZone               *string `json:"time-zone"`
	Source                 *string `json:"source"`
	SheetID                *string `json:"sheet-id"`
	SheetName              *string `json:"sheet-name"`
	SheetsCredentials      *string `json:"sheets-credentials"`
	ScaleExporterOutputDir *string `json:"scale-exporter-output-dir"`
	AppleHealthExportXML   *string `json:"apple-health-export-xml"`
	GoogleFitTokenPath     *string `json:"google-fit-token-path"`
	GoogleFitLookbackDays  *int    `json:"google-fit-lookback-days"`
	GoogleFitClientID      *string `json:"google-fit-client-id"`
	GoogleFitClientSecret  *string `json:"google-fit-client-secret"`
	GoogleFitRedirectURI   *string `json:"google-fit-redirect-uri"`
	MorningCron            *string `json:"morning-cron"`
	EveningCron            *string `json:"evening-cron"`
}

type GoogleFitCredentialsFile struct {
	ClientID     string
	ClientSecret string
	RedirectURI  string
}

func ExpandHomePath(value, homeDir string) string {
	if value == "~" {
		return homeDir
	}
	if strings.HasPrefix(value, "~/") {
		return filepath.Join(homeDir, value[2:])
	}
	return value
}

func ParseSettingsFile(data []byte, settingsPath string) (SettingsFile, error) {
	var settings SettingsFile
	if err := json.Unmarshal(data, &settings); err != nil {
		return SettingsFile{}, &ConfigError{Message: fmt.Sprintf("invalid settings file: %s: %v", settingsPath, err)}
	}
	if err := validateSettings(settings, settingsPath); err != nil {
		return SettingsFile{}, err
	}
	trimSettings(&settings)
	return settings, nil
}

func LoadOrCreateSettings(settingsPath string) (SettingsFile, error) {
	homeDir, err := os.UserHomeDir()
	if err != nil {
		return SettingsFile{}, &ConfigError{Message: fmt.Sprintf("cannot resolve home directory: %v", err)}
	}
	resolvedPath := ExpandHomePath(settingsPath, homeDir)
	configDir := filepath.Dir(resolvedPath)
	data, err := os.ReadFile(resolvedPath)
	if os.IsNotExist(err) {
		settings := DefaultSettingsContent(configDir)
		if err := os.MkdirAll(configDir, 0o755); err != nil {
			return SettingsFile{}, &ConfigError{Message: fmt.Sprintf("cannot create settings directory: %s: %v", configDir, err)}
		}
		encoded, err := json.MarshalIndent(settings, "", "  ")
		if err != nil {
			return SettingsFile{}, err
		}
		encoded = append(encoded, '\n')
		if err := os.WriteFile(resolvedPath, encoded, 0o600); err != nil {
			return SettingsFile{}, &ConfigError{Message: fmt.Sprintf("cannot create settings file: %s: %v", resolvedPath, err)}
		}
		return settings, nil
	}
	if err != nil {
		return SettingsFile{}, &ConfigError{Message: fmt.Sprintf("invalid settings file: %s: %v", resolvedPath, err)}
	}
	return ParseSettingsFile(data, resolvedPath)
}

func DefaultSettingsContent(configDir string) SettingsFile {
	timeZone := "Asia/Tokyo"
	source := "scale-exporter"
	sheetName := "体温・血圧"
	sheetsCredentials := filepath.Join(configDir, "google-sheets-service-account.json")
	tokenPath := filepath.Join(configDir, "google-fit-token.json")
	morningCron := "0 7 * * *"
	eveningCron := "0 21 * * *"
	return SettingsFile{
		TimeZone:           &timeZone,
		Source:             &source,
		SheetName:          &sheetName,
		SheetsCredentials:  &sheetsCredentials,
		GoogleFitTokenPath: &tokenPath,
		MorningCron:        &morningCron,
		EveningCron:        &eveningCron,
	}
}

func LoadGoogleFitCredentials(configDir string) (*GoogleFitCredentialsFile, error) {
	credentialsPath := filepath.Join(configDir, "google-fit-credentials.json")
	data, err := os.ReadFile(credentialsPath)
	if os.IsNotExist(err) {
		return nil, nil
	}
	if err != nil {
		return nil, &ConfigError{Message: fmt.Sprintf("invalid credentials file: %s: %v", credentialsPath, err)}
	}
	var raw struct {
		ClientID     string `json:"client_id"`
		ClientSecret string `json:"client_secret"`
		RedirectURI  string `json:"redirect_uri"`
	}
	if err := json.Unmarshal(data, &raw); err != nil {
		return nil, &ConfigError{Message: fmt.Sprintf("invalid credentials file: %s: %v", credentialsPath, err)}
	}
	raw.ClientID = strings.TrimSpace(raw.ClientID)
	raw.ClientSecret = strings.TrimSpace(raw.ClientSecret)
	raw.RedirectURI = strings.TrimSpace(raw.RedirectURI)
	if raw.ClientID == "" || raw.ClientSecret == "" {
		return nil, &ConfigError{Message: fmt.Sprintf("invalid credentials file: %s: client_id and client_secret are required", credentialsPath)}
	}
	return &GoogleFitCredentialsFile{ClientID: raw.ClientID, ClientSecret: raw.ClientSecret, RedirectURI: raw.RedirectURI}, nil
}

func validateSettings(settings SettingsFile, path string) error {
	for name, value := range map[string]*string{
		"time-zone":                 settings.TimeZone,
		"source":                    settings.Source,
		"sheet-id":                  settings.SheetID,
		"sheet-name":                settings.SheetName,
		"sheets-credentials":        settings.SheetsCredentials,
		"scale-exporter-output-dir": settings.ScaleExporterOutputDir,
		"apple-health-export-xml":   settings.AppleHealthExportXML,
		"google-fit-token-path":     settings.GoogleFitTokenPath,
		"google-fit-client-id":      settings.GoogleFitClientID,
		"google-fit-client-secret":  settings.GoogleFitClientSecret,
		"google-fit-redirect-uri":   settings.GoogleFitRedirectURI,
		"morning-cron":              settings.MorningCron,
		"evening-cron":              settings.EveningCron,
	} {
		if value != nil && strings.TrimSpace(*value) == "" {
			return &ConfigError{Message: fmt.Sprintf("invalid settings file: %s: %s must not be empty", path, name)}
		}
	}
	if settings.Source != nil {
		source := strings.TrimSpace(*settings.Source)
		if source != "scale-exporter" && source != "google-fit" && source != "apple-health" {
			return &ConfigError{Message: fmt.Sprintf("invalid settings file: %s: source must be scale-exporter, google-fit or apple-health", path)}
		}
	}
	if settings.GoogleFitLookbackDays != nil && *settings.GoogleFitLookbackDays <= 0 {
		return &ConfigError{Message: fmt.Sprintf("invalid settings file: %s: google-fit-lookback-days must be positive", path)}
	}
	return nil
}

func trimSettings(settings *SettingsFile) {
	for _, value := range []*string{
		settings.TimeZone,
		settings.Source,
		settings.SheetID,
		settings.SheetName,
		settings.SheetsCredentials,
		settings.ScaleExporterOutputDir,
		settings.AppleHealthExportXML,
		settings.GoogleFitTokenPath,
		settings.GoogleFitClientID,
		settings.GoogleFitClientSecret,
		settings.GoogleFitRedirectURI,
		settings.MorningCron,
		settings.EveningCron,
	} {
		if value != nil {
			*value = strings.TrimSpace(*value)
		}
	}
}
