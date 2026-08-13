package config

import (
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

const DefaultGoogleSheetName = "体温・血圧"

type GoogleFitAuthConfig struct {
	ClientID     string
	ClientSecret string
	RedirectURI  string
	TokenPath    string
	LookbackDays int
}

type GoogleSheetsAuthConfig struct {
	ApplicationCredentialsPath string
	SpreadsheetID              string
	SheetName                  string
}

type AppleHealthConfig struct {
	ExportXMLPath string
}

type ScaleExporterConfig struct {
	OutputDir string
}

type SchedulerConfig struct {
	MorningCron string
	EveningCron string
}

type AppConfig struct {
	TimeZone      string
	DefaultSource string
	GoogleFit     *GoogleFitAuthConfig
	GoogleSheets  *GoogleSheetsAuthConfig
	AppleHealth   *AppleHealthConfig
	ScaleExporter *ScaleExporterConfig
	Scheduler     SchedulerConfig
}

func Load(settingsPath string, env map[string]string) (AppConfig, error) {
	homeDir, err := os.UserHomeDir()
	if err != nil {
		return AppConfig{}, &ConfigError{Message: fmt.Sprintf("cannot resolve home directory: %v", err)}
	}
	if settingsPath == "" {
		settingsPath = DefaultSettingsPath
	}
	resolvedSettingsPath := ExpandHomePath(settingsPath, homeDir)
	settings, err := LoadOrCreateSettings(resolvedSettingsPath)
	if err != nil {
		return AppConfig{}, err
	}
	configDir := filepath.Dir(resolvedSettingsPath)

	getString := func(key string, setting *string, fallback string) string {
		if value := nonBlank(env[key]); value != "" {
			return value
		}
		if setting != nil {
			return strings.TrimSpace(*setting)
		}
		return fallback
	}

	config := AppConfig{
		TimeZone:      getString("TIME_ZONE", settings.TimeZone, "Asia/Tokyo"),
		DefaultSource: "scale-exporter",
		Scheduler: SchedulerConfig{
			MorningCron: getString("MORNING_CRON", settings.MorningCron, "0 7 * * *"),
			EveningCron: getString("EVENING_CRON", settings.EveningCron, "0 21 * * *"),
		},
	}
	if settings.Source != nil {
		config.DefaultSource = *settings.Source
	}

	if outputDir := getString("SCALE_EXPORTER_OUTPUT_DIR", settings.ScaleExporterOutputDir, ""); outputDir != "" {
		config.ScaleExporter = &ScaleExporterConfig{OutputDir: ExpandHomePath(outputDir, homeDir)}
	}
	if exportXML := getString("APPLE_HEALTH_EXPORT_XML", settings.AppleHealthExportXML, ""); exportXML != "" {
		config.AppleHealth = &AppleHealthConfig{ExportXMLPath: ExpandHomePath(exportXML, homeDir)}
	}

	sheetID := getString("GOOGLE_SHEET_ID", settings.SheetID, "")
	credentialsPath := getString("GOOGLE_APPLICATION_CREDENTIALS", settings.SheetsCredentials, "")
	if sheetID != "" && credentialsPath != "" {
		config.GoogleSheets = &GoogleSheetsAuthConfig{
			ApplicationCredentialsPath: ExpandHomePath(credentialsPath, homeDir),
			SpreadsheetID:              sheetID,
			SheetName:                  getString("GOOGLE_SHEET_NAME", settings.SheetName, DefaultGoogleSheetName),
		}
	}

	clientID := getString("GOOGLE_FIT_CLIENT_ID", settings.GoogleFitClientID, "")
	clientSecret := getString("GOOGLE_FIT_CLIENT_SECRET", settings.GoogleFitClientSecret, "")
	redirectURI := getString("GOOGLE_FIT_REDIRECT_URI", settings.GoogleFitRedirectURI, "http://localhost:3000/oauth2callback")
	if (clientID == "" || clientSecret == "") && configDir != "" {
		credentials, err := LoadGoogleFitCredentials(configDir)
		if err != nil {
			return AppConfig{}, err
		}
		if credentials != nil {
			clientID = credentials.ClientID
			clientSecret = credentials.ClientSecret
			if credentials.RedirectURI != "" {
				redirectURI = credentials.RedirectURI
			}
		}
	}
	lookbackDays, err := positiveIntSetting("GOOGLE_FIT_LOOKBACK_DAYS", settings.GoogleFitLookbackDays, env, 14)
	if err != nil {
		return AppConfig{}, err
	}
	if clientID != "" && clientSecret != "" {
		config.GoogleFit = &GoogleFitAuthConfig{
			ClientID:     clientID,
			ClientSecret: clientSecret,
			RedirectURI:  redirectURI,
			TokenPath:    ExpandHomePath(getString("GOOGLE_FIT_TOKEN_PATH", settings.GoogleFitTokenPath, "~/.config/scale2sheet/google-fit-token.json"), homeDir),
			LookbackDays: lookbackDays,
		}
	}

	return config, nil
}

func RequireGoogleFitConfig(config AppConfig) (*GoogleFitAuthConfig, error) {
	if config.GoogleFit == nil {
		return nil, &ConfigError{Message: "Google Fit requires client credentials: set GOOGLE_FIT_CLIENT_ID / GOOGLE_FIT_CLIENT_SECRET, or create ~/.config/scale2sheet/google-fit-credentials.json."}
	}
	return config.GoogleFit, nil
}

func RequireGoogleSheetsConfig(config AppConfig) (*GoogleSheetsAuthConfig, error) {
	if config.GoogleSheets == nil {
		return nil, &ConfigError{Message: "Google Sheets requires both sheet-id and sheets-credentials in ~/.config/scale2sheet/settings.json (or GOOGLE_SHEET_ID / GOOGLE_APPLICATION_CREDENTIALS)."}
	}
	return config.GoogleSheets, nil
}

func RequireAppleHealthConfig(config AppConfig) (*AppleHealthConfig, error) {
	if config.AppleHealth == nil {
		return nil, &ConfigError{Message: "Apple Health requires apple-health-export-xml in settings.json or APPLE_HEALTH_EXPORT_XML."}
	}
	return config.AppleHealth, nil
}

func RequireScaleExporterConfig(config AppConfig) (*ScaleExporterConfig, error) {
	if config.ScaleExporter == nil {
		return nil, &ConfigError{Message: "The scale-exporter source requires scale-exporter-output-dir in ~/.config/scale2sheet/settings.json (or SCALE_EXPORTER_OUTPUT_DIR), pointing at your scale_exporter JSONL output folder."}
	}
	return config.ScaleExporter, nil
}

func nonBlank(value string) string { return strings.TrimSpace(value) }

func positiveIntSetting(key string, setting *int, env map[string]string, fallback int) (int, error) {
	if value := nonBlank(env[key]); value != "" {
		parsed, err := strconv.Atoi(value)
		if err != nil || parsed <= 0 {
			return 0, &ConfigError{Message: fmt.Sprintf("invalid %s: must be a positive integer", key)}
		}
		return parsed, nil
	}
	if setting != nil {
		if *setting <= 0 {
			return 0, &ConfigError{Message: "invalid google-fit-lookback-days: must be positive"}
		}
		return *setting, nil
	}
	return fallback, nil
}
