package scheduler

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"
)

const (
	DarwinOExlock         = 0x0020
	SocketPathMaxBytes    = 103
	defaultStopPollPeriod = 15 * time.Second
)

type RunLeaseError struct{ Message string }

func (e *RunLeaseError) Error() string { return e.Message }

type RunLeaseConflictError struct{ RunLeaseError }

func newLeaseError(message string) error { return &RunLeaseError{Message: message} }

type AcquireOptions struct {
	ConfigDir          string
	Kind               string
	Origin             string
	Period             string
	LaunchdLabel       string
	Platform           string
	StopPollInterval   time.Duration
	StartedAt          func() time.Time
	OwnerToken         string
	RuntimeDirectory   string
	SocketPathOverride string
}

type RunReceipt struct {
	OwnerToken   string `json:"owner-token"`
	SocketPath   string `json:"socket-path"`
	Kind         string `json:"kind"`
	Origin       string `json:"origin"`
	Period       string `json:"period,omitempty"`
	LaunchdLabel string `json:"launchd-label,omitempty"`
	PID          int    `json:"pid"`
	StartedAt    string `json:"started-at"`
}

type ActiveRunReceiptInfo struct {
	Kind      string
	Origin    string
	Period    string
	PID       int
	StartedAt string
}

type LeaseHandle struct {
	ownerToken  string
	socketPath  string
	receiptPath string
	lockPath    string
	stopPath    string
	lockFile    *os.File
	socket      net.Listener
	stopPeriod  time.Duration

	mu       sync.Mutex
	released bool
	stopOnce sync.Once
}

func BuildLockFlags() int {
	return syscall.O_CREAT | syscall.O_RDWR | DarwinOExlock | syscall.O_NONBLOCK | syscall.O_NOFOLLOW
}

func AcquireRunLease(options AcquireOptions) (*LeaseHandle, error) {
	platform := options.Platform
	if platform == "" {
		platform = runtime.GOOS
	}
	if platform != "darwin" {
		return nil, newLeaseError("run lease is supported only on macOS")
	}
	configDir := options.ConfigDir
	if configDir == "" {
		home, err := os.UserHomeDir()
		if err != nil {
			return nil, newLeaseError("cannot resolve home directory: " + err.Error())
		}
		configDir = filepath.Join(home, ".config", "scale2sheet")
	}
	physicalConfigDir, err := physicalPath(configDir)
	if err != nil {
		return nil, err
	}
	if err := os.MkdirAll(physicalConfigDir, 0o700); err != nil {
		return nil, newLeaseError("cannot create configuration directory: " + err.Error())
	}
	if err := os.Chmod(physicalConfigDir, 0o700); err != nil {
		return nil, newLeaseError("cannot secure configuration directory: " + err.Error())
	}
	namespace := sha256.Sum256([]byte(physicalConfigDir))
	runtimeDir := options.RuntimeDirectory
	if runtimeDir == "" {
		runtimeDir = filepath.Join("/tmp", "scale2sheet-"+strconv.Itoa(os.Getuid())+"-"+hex.EncodeToString(namespace[:])[:16])
	}
	if err := ensureRuntimeDirectory(runtimeDir); err != nil {
		return nil, err
	}
	lockPath := filepath.Join(runtimeDir, "active-run.lock")
	ownerToken := options.OwnerToken
	if ownerToken == "" {
		ownerToken = randomOwnerToken()
	}
	socketPath := options.SocketPathOverride
	if socketPath == "" {
		socketPath = filepath.Join(runtimeDir, "run-"+ownerToken+".sock")
	}
	if len([]byte(socketPath)) > SocketPathMaxBytes {
		return nil, newLeaseError(fmt.Sprintf("run lease socket path exceeds %d bytes", SocketPathMaxBytes))
	}
	fd, err := syscall.Open(lockPath, BuildLockFlags(), 0o600)
	if err != nil {
		if errors.Is(err, syscall.EAGAIN) || errors.Is(err, syscall.EWOULDBLOCK) {
			return nil, &RunLeaseConflictError{RunLeaseError{Message: "another scale2sheet run lease is active"}}
		}
		return nil, newLeaseError("cannot acquire run lease: " + err.Error())
	}
	lockFile := os.NewFile(uintptr(fd), lockPath)
	if err := validateLockFile(lockFile); err != nil {
		_ = lockFile.Close()
		return nil, err
	}
	if err := recoverDeadOwner(filepath.Join(physicalConfigDir, "active-run.json"), runtimeDir); err != nil {
		_ = lockFile.Close()
		return nil, err
	}
	_ = os.Remove(socketPath)
	listener, err := net.Listen("unix", socketPath)
	if err != nil {
		_ = lockFile.Close()
		return nil, newLeaseError("cannot listen on run lease socket: " + err.Error())
	}
	if err := os.Chmod(socketPath, 0o600); err != nil {
		_ = listener.Close()
		_ = os.Remove(socketPath)
		_ = lockFile.Close()
		return nil, newLeaseError("cannot set owner socket permissions: " + err.Error())
	}
	startedAt := time.Now
	if options.StartedAt != nil {
		startedAt = options.StartedAt
	}
	receipt := RunReceipt{OwnerToken: ownerToken, SocketPath: socketPath, Kind: defaultString(options.Kind, "serve"), Origin: defaultString(options.Origin, "manual"), Period: options.Period, LaunchdLabel: options.LaunchdLabel, PID: os.Getpid(), StartedAt: startedAt().UTC().Format("2006-01-02T15:04:05.000Z")}
	receiptPath := filepath.Join(physicalConfigDir, "active-run.json")
	if err := writeAtomically(receiptPath, receipt, 0o600); err != nil {
		_ = listener.Close()
		_ = os.Remove(socketPath)
		_ = lockFile.Close()
		return nil, err
	}
	stopPeriod := options.StopPollInterval
	if stopPeriod <= 0 {
		stopPeriod = defaultStopPollPeriod
	}
	return &LeaseHandle{ownerToken: ownerToken, socketPath: socketPath, receiptPath: receiptPath, lockPath: lockPath, stopPath: filepath.Join(physicalConfigDir, "active-run.stop."+ownerToken+".json"), lockFile: lockFile, socket: listener, stopPeriod: stopPeriod}, nil
}

func (h *LeaseHandle) OwnerToken() string  { return h.ownerToken }
func (h *LeaseHandle) SocketPath() string  { return h.socketPath }
func (h *LeaseHandle) ReceiptPath() string { return h.receiptPath }
func (h *LeaseHandle) LockPath() string    { return h.lockPath }

func (h *LeaseHandle) StartStopPolling(onStop func()) {
	if h == nil || onStop == nil {
		return
	}
	go func() {
		ticker := time.NewTicker(h.stopPeriod)
		defer ticker.Stop()
		for range ticker.C {
			if h.ownsStopRequest() {
				h.stopOnce.Do(onStop)
				return
			}
			if h.isReleased() {
				return
			}
		}
	}()
}

func (h *LeaseHandle) Release() error {
	if h == nil {
		return nil
	}
	h.mu.Lock()
	if h.released {
		h.mu.Unlock()
		return nil
	}
	h.released = true
	h.mu.Unlock()
	if err := h.socket.Close(); err != nil && !errors.Is(err, net.ErrClosed) {
		return err
	}
	_ = os.Remove(h.socketPath)
	_ = removeOwnedFile(h.receiptPath, h.ownerToken)
	_ = removeOwnedFile(h.stopPath, h.ownerToken)
	return h.lockFile.Close()
}

func (h *LeaseHandle) isReleased() bool {
	h.mu.Lock()
	defer h.mu.Unlock()
	return h.released
}

func (h *LeaseHandle) ownsStopRequest() bool {
	data, err := os.ReadFile(h.stopPath)
	if err != nil {
		return false
	}
	var request struct {
		OwnerToken string `json:"owner-token"`
	}
	return json.Unmarshal(data, &request) == nil && request.OwnerToken == h.ownerToken
}

func RequestCooperativeStop(configDir, ownerToken string) error {
	if !regexp.MustCompile(`^[a-f0-9]{32,}$`).MatchString(ownerToken) {
		return newLeaseError("invalid run lease owner token")
	}
	physicalConfigDir, err := physicalPath(configDir)
	if err != nil {
		return err
	}
	return writeAtomically(filepath.Join(physicalConfigDir, "active-run.stop."+ownerToken+".json"), map[string]string{"owner-token": ownerToken}, 0o600)
}

func ReadActiveRunReceipt(configDir string) *ActiveRunReceiptInfo {
	data, err := os.ReadFile(filepath.Join(configDir, "active-run.json"))
	if err != nil {
		return nil
	}
	var receipt RunReceipt
	if json.Unmarshal(data, &receipt) != nil || !validReceipt(&receipt) {
		return nil
	}
	return &ActiveRunReceiptInfo{Kind: receipt.Kind, Origin: receipt.Origin, Period: receipt.Period, PID: receipt.PID, StartedAt: receipt.StartedAt}
}

func validReceipt(receipt *RunReceipt) bool {
	if receipt == nil || receipt.PID <= 0 || receipt.StartedAt == "" {
		return false
	}
	validKind := receipt.Kind == "serve" || receipt.Kind == "pipeline" || receipt.Kind == "maintenance"
	validOrigin := receipt.Origin == "launchd" || receipt.Origin == "manual" || receipt.Origin == "maintenance"
	return validKind && validOrigin && (receipt.Period == "" || receipt.Period == "morning" || receipt.Period == "evening")
}

func physicalPath(input string) (string, error) {
	absolute, err := filepath.Abs(input)
	if err != nil {
		return "", newLeaseError("cannot resolve configuration path: " + err.Error())
	}
	if resolved, err := filepath.EvalSymlinks(absolute); err == nil {
		return resolved, nil
	}
	parent := absolute
	var suffix []string
	for {
		info, statErr := os.Stat(parent)
		if statErr == nil && info.IsDir() {
			resolved, resolveErr := filepath.EvalSymlinks(parent)
			if resolveErr != nil {
				return "", newLeaseError("cannot resolve configuration path: " + resolveErr.Error())
			}
			for i := len(suffix) - 1; i >= 0; i-- {
				resolved = filepath.Join(resolved, suffix[i])
			}
			return resolved, nil
		}
		next := filepath.Dir(parent)
		if next == parent {
			return "", newLeaseError("configuration path has no existing ancestor: " + absolute)
		}
		suffix = append(suffix, filepath.Base(parent))
		parent = next
	}
}

func ensureRuntimeDirectory(path string) error {
	if err := os.MkdirAll(path, 0o700); err != nil {
		return newLeaseError("cannot create run lease runtime directory: " + err.Error())
	}
	info, err := os.Stat(path)
	if err != nil || !info.IsDir() || info.Mode().Perm() != 0o700 {
		return newLeaseError("run lease runtime directory has unsafe owner, mode, or type")
	}
	return nil
}

func validateLockFile(file *os.File) error {
	info, err := file.Stat()
	if err != nil || !info.Mode().IsRegular() || info.Mode().Perm() != 0o600 {
		return newLeaseError("run lease lock file has unsafe owner, mode, or type")
	}
	return nil
}

func recoverDeadOwner(receiptPath, runtimeDir string) error {
	data, err := os.ReadFile(receiptPath)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return newLeaseError("run lease receipt is invalid: " + receiptPath + ". No owner holds the lock; remove this receipt and retry.")
	}
	var receipt RunReceipt
	if err := json.Unmarshal(data, &receipt); err != nil || receipt.OwnerToken == "" || receipt.SocketPath != filepath.Join(runtimeDir, "run-"+receipt.OwnerToken+".sock") {
		return newLeaseError("run lease receipt is invalid: " + receiptPath + ". No owner holds the lock; remove this receipt and retry.")
	}
	_ = os.Remove(receipt.SocketPath)
	_ = os.Remove(receiptPath)
	return nil
}

func writeAtomically(path string, value any, mode os.FileMode) error {
	data, err := json.Marshal(value)
	if err != nil {
		return err
	}
	data = append(data, '\n')
	temporary := fmt.Sprintf("%s.tmp-%d-%d", path, os.Getpid(), time.Now().UnixNano())
	if err := os.WriteFile(temporary, data, mode); err != nil {
		return err
	}
	if err := os.Chmod(temporary, mode); err != nil {
		_ = os.Remove(temporary)
		return err
	}
	if err := os.Rename(temporary, path); err != nil {
		_ = os.Remove(temporary)
		return err
	}
	return nil
}

func removeOwnedFile(path, ownerToken string) error {
	data, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	var value struct {
		OwnerToken string `json:"owner-token"`
	}
	if json.Unmarshal(data, &value) == nil && value.OwnerToken == ownerToken {
		return os.Remove(path)
	}
	return nil
}

func randomOwnerToken() string {
	buffer := make([]byte, 16)
	if _, err := rand.Read(buffer); err == nil {
		return hex.EncodeToString(buffer)
	}
	return fmt.Sprintf("%032x", time.Now().UnixNano())
}

func defaultString(value, fallback string) string {
	if strings.TrimSpace(value) == "" {
		return fallback
	}
	return value
}
