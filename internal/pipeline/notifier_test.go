package pipeline

import "testing"

func TestMacOSNotifierTreatsMissingExecutableAsBestEffort(t *testing.T) {
	if err := NewMacOSNotifier(filepathDoesNotExist()).Notify(PeriodMorning, "normal", "alert"); err != nil {
		t.Fatalf("Notify() error = %v", err)
	}
}

func filepathDoesNotExist() string { return "/definitely/missing/scale2sheet-osascript" }
