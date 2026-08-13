package scheduler

import (
	"context"
	"fmt"
	"strconv"
	"strings"
	"time"
)

type SchedulerConfig struct {
	MorningCron string
	EveningCron string
	TimeZone    *time.Location
}

type SchedulerRunner func(context.Context, string) error

type SchedulerLogger interface {
	Log(string)
	Error(error)
}

type defaultSchedulerLogger struct{}

func (defaultSchedulerLogger) Log(string)  {}
func (defaultSchedulerLogger) Error(error) {}

func RunServe(ctx context.Context, config SchedulerConfig, runner SchedulerRunner, logger SchedulerLogger) error {
	if ctx == nil {
		ctx = context.Background()
	}
	if runner == nil {
		return fmt.Errorf("scheduler runner is required")
	}
	if logger == nil {
		logger = defaultSchedulerLogger{}
	}
	zone := config.TimeZone
	if zone == nil {
		zone = time.UTC
	}
	logger.Log(fmt.Sprintf("Scheduler started: morning=%q, evening=%q, timezone=%q", config.MorningCron, config.EveningCron, zone.String()))
	ticker := time.NewTicker(time.Minute)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case now := <-ticker.C:
			local := now.In(zone)
			for period, expression := range map[string]string{"morning": config.MorningCron, "evening": config.EveningCron} {
				matched, err := MatchesCron(expression, local)
				if err != nil {
					return err
				}
				if matched {
					if err := runner(ctx, period); err != nil {
						logger.Error(err)
					}
				}
			}
		}
	}
}

func MatchesCron(expression string, value time.Time) (bool, error) {
	parts := strings.Fields(expression)
	if len(parts) != 5 {
		return false, fmt.Errorf("cron expression must contain five fields: %q", expression)
	}
	fields := []struct {
		value int
		name  string
	}{
		{value: value.Minute(), name: "minute"},
		{value: value.Hour(), name: "hour"},
		{value: value.Day(), name: "day-of-month"},
		{value: int(value.Month()), name: "month"},
		{value: int(value.Weekday()), name: "day-of-week"},
	}
	for index, field := range fields {
		matched, err := matchCronField(parts[index], field.value)
		if err != nil {
			return false, fmt.Errorf("invalid cron %s: %w", field.name, err)
		}
		if !matched {
			return false, nil
		}
	}
	return true, nil
}

func matchCronField(expression string, value int) (bool, error) {
	if expression == "*" {
		return true, nil
	}
	for _, item := range strings.Split(expression, ",") {
		if strings.Contains(item, "-") {
			bounds := strings.Split(item, "-")
			if len(bounds) != 2 {
				return false, fmt.Errorf("invalid range %q", item)
			}
			start, err1 := strconv.Atoi(bounds[0])
			end, err2 := strconv.Atoi(bounds[1])
			if err1 != nil || err2 != nil || start > end {
				return false, fmt.Errorf("invalid range %q", item)
			}
			if value >= start && value <= end {
				return true, nil
			}
			continue
		}
		parsed, err := strconv.Atoi(item)
		if err != nil {
			return false, fmt.Errorf("invalid value %q", item)
		}
		if parsed == value {
			return true, nil
		}
	}
	return false, nil
}
