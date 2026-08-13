package cli

import "testing"

func TestParseInvocation(t *testing.T) {
	tests := []struct {
		name    string
		args    []string
		want    Invocation
		wantErr string
	}{
		{
			name: "empty arguments show help",
			args: nil,
			want: Invocation{Help: true},
		},
		{
			name: "global help",
			args: []string{"--help"},
			want: Invocation{Help: true},
		},
		{
			name: "version",
			args: []string{"--version"},
			want: Invocation{Version: true},
		},
		{
			name: "pipeline morning",
			args: []string{"pipeline", "--period", "morning"},
			want: Invocation{Command: CommandPipeline, Period: PeriodMorning},
		},
		{
			name: "run with source and date",
			args: []string{
				"run",
				"--period",
				"evening",
				"--source",
				"apple-health",
				"--date",
				"2026-06-18",
			},
			want: Invocation{
				Command: CommandRun,
				Period:  PeriodEvening,
				Source:  SourceAppleHealth,
				Date:    "2026-06-18",
			},
		},
		{
			name: "install dry run",
			args: []string{"install", "--launchd", "--dry-run"},
			want: Invocation{Command: CommandInstall, Launchd: true, DryRun: true},
		},
		{
			name: "doctor with custom prefix",
			args: []string{"doctor", "--prefix", "/tmp/scale2sheet-custom"},
			want: Invocation{Command: CommandDoctor, Prefix: "/tmp/scale2sheet-custom"},
		},
		{
			name:    "unknown command",
			args:    []string{"not-a-command"},
			wantErr: "unknown command",
		},
		{
			name:    "run period is required",
			args:    []string{"run"},
			wantErr: "period is required",
		},
		{
			name:    "invalid period",
			args:    []string{"run", "--period", "night"},
			wantErr: "period must be morning or evening",
		},
		{
			name:    "invalid source",
			args:    []string{"run", "--period", "morning", "--source", "unknown"},
			wantErr: "source must be scale-exporter, google-fit or apple-health",
		},
		{
			name:    "invalid date shape",
			args:    []string{"run", "--period", "morning", "--date", "2026/06/18"},
			wantErr: "date must be YYYY-MM-DD",
		},
		{
			name:    "invalid calendar date",
			args:    []string{"run", "--period", "morning", "--date", "2026-02-30"},
			wantErr: "date must be a valid YYYY-MM-DD date",
		},
		{
			name:    "unknown option",
			args:    []string{"run", "--period", "morning", "--unknown"},
			wantErr: "unknown option",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := Parse(tt.args)
			if tt.wantErr != "" {
				if err == nil || err.Error() != tt.wantErr {
					t.Fatalf("Parse() error = %v, want %q", err, tt.wantErr)
				}
				if ExitCode(err) != 2 {
					t.Fatalf("ExitCode(error) = %d, want 2", ExitCode(err))
				}
				return
			}
			if err != nil {
				t.Fatalf("Parse() unexpected error: %v", err)
			}
			if got != tt.want {
				t.Fatalf("Parse() = %#v, want %#v", got, tt.want)
			}
			if ExitCode(nil) != 0 {
				t.Fatalf("ExitCode(nil) = %d, want 0", ExitCode(nil))
			}
		})
	}
}
