package cli

import (
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/kappaseijin/scale2sheet4go/internal/installation"
)

func TestDoctorUsesCustomPrefix(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	prefix := filepath.Join(home, "custom")
	paths, err := installation.ResolvePaths(home, prefix)
	if err != nil {
		t.Fatalf("ResolvePaths() error = %v", err)
	}
	if err := os.MkdirAll(paths.BinDir, 0o755); err != nil {
		t.Fatalf("MkdirAll() error = %v", err)
	}
	if err := os.WriteFile(paths.BinaryPath, []byte("binary"), 0o755); err != nil {
		t.Fatalf("WriteFile() error = %v", err)
	}
	manifest := installation.MakeInstallingManifest(paths, false)
	if err := installation.WriteManifest(paths.ManifestPath, manifest); err != nil {
		t.Fatalf("WriteManifest(initial) error = %v", err)
	}
	manifest.State = installation.ManifestInstalled
	if err := installation.WriteManifest(paths.ManifestPath, manifest); err != nil {
		t.Fatalf("WriteManifest(installed) error = %v", err)
	}

	var out, errOut bytes.Buffer
	runDoctorCommand(Invocation{Prefix: prefix}, Output{Out: &out, Err: &errOut})
	if !strings.Contains(out.String(), "state=installed") {
		t.Fatalf("doctor output = %q, want installed custom-prefix manifest", out.String())
	}
	if !strings.Contains(out.String(), "[PASS] prefix: "+paths.Prefix) {
		t.Fatalf("doctor output = %q, want matching custom prefix %q", out.String(), paths.Prefix)
	}
	if !strings.Contains(out.String(), paths.BinaryPath) {
		t.Fatalf("doctor output = %q, want custom binary path %q", out.String(), paths.BinaryPath)
	}
}
