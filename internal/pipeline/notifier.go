package pipeline

import (
	"encoding/json"
	"os/exec"
)

type MacOSNotifier struct {
	ExecutablePath string
}

func NewMacOSNotifier(executablePath string) *MacOSNotifier {
	if executablePath == "" {
		executablePath = "/usr/bin/osascript"
	}
	return &MacOSNotifier{ExecutablePath: executablePath}
}

// Notify is best effort by design: a desktop notification must not change the
// pipeline result after the status writer has claimed the transition.
func (n *MacOSNotifier) Notify(period PipelinePeriod, fromState, toState, reason string) error {
	if n == nil || n.ExecutablePath == "" {
		return nil
	}
	message := "復旧しました（period=" + string(period) + "）"
	if toState == "alert" {
		message = "異常を検知しました（period=" + string(period) + "）"
		if reason == NotificationReasonInputInvalid {
			message = "入力全体を信用できないため、転記していません（period=" + string(period) + "）"
		}
	}
	quoted, err := json.Marshal(message)
	if err != nil {
		return nil
	}
	script := "display notification " + string(quoted) + ` with title "scale-pipeline" sound name "Basso"`
	command := exec.Command(n.ExecutablePath, "-e", script)
	_ = command.Run()
	return nil
}
