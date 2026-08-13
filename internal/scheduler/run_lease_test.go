package scheduler

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
)

func TestBuildLockFlagsIncludesDarwinExclusiveLock(t *testing.T) {
	if DarwinOExlock != 0x20 || BuildLockFlags()&DarwinOExlock != DarwinOExlock {
		t.Fatalf("flags = %#x", BuildLockFlags())
	}
}

func TestAcquireRunLeaseRejectsUnsupportedPlatform(t *testing.T) {
	if _, err := AcquireRunLease(AcquireOptions{ConfigDir: t.TempDir(), Platform: "linux"}); err == nil {
		t.Fatal("unsupported platform unexpectedly accepted")
	}
}

func TestReadActiveRunReceiptReturnsNilForMalformedReceipt(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "active-run.json"), []byte("{bad"), 0o600); err != nil {
		t.Fatal(err)
	}
	if got := ReadActiveRunReceipt(dir); got != nil {
		t.Fatalf("receipt = %#v, want nil", got)
	}
}

func TestMatchesCron(t *testing.T) {
	value := time.Date(2026, 8, 13, 7, 0, 0, 0, time.UTC)
	matched, err := MatchesCron("0 7 * * *", value)
	if err != nil || !matched {
		t.Fatalf("matched, err = %v, %v", matched, err)
	}
	matched, err = MatchesCron("0 21 * * *", value)
	if err != nil || matched {
		t.Fatalf("matched, err = %v, %v", matched, err)
	}
}

func TestAcquireRunLeaseOnCurrentDarwinWritesReceipt(t *testing.T) {
	if runtime.GOOS != "darwin" {
		t.Skip("lease is a macOS runtime contract")
	}
	dir := t.TempDir()
	handle, err := AcquireRunLease(AcquireOptions{ConfigDir: dir, StopPollInterval: 5 * time.Millisecond})
	if err != nil {
		t.Fatal(err)
	}
	defer handle.Release()
	if !strings.HasPrefix(handle.OwnerToken(), "0") && len(handle.OwnerToken()) < 32 {
		t.Fatalf("owner token = %q", handle.OwnerToken())
	}
	if _, err := os.Stat(handle.ReceiptPath()); err != nil {
		t.Fatal(err)
	}
}
