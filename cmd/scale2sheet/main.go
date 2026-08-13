package main

import (
	"fmt"
	"os"

	"github.com/kappaseijin/scale2sheet4go/internal/cli"
)

const appVersion = "0.1.0"

func main() {
	invocation, err := cli.Parse(os.Args[1:])
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(cli.ExitCode(err))
	}
	if invocation.Help {
		fmt.Print(`Usage: scale2sheet <command> [options]

Commands:
  auth       Run the Google Fit OAuth flow.
  doctor     Inspect the installed runtime.
  install    Install the scale2sheet binary and settings.
  pipeline   Transfer a stable scale-exporter snapshot.
  run        Transfer the latest measurements.
  serve      Run morning/evening schedules.
  uninstall  Remove the installed runtime.

Options:
  --help     Show this help.
  --version  Show the version.
`)
		return
	}
	if invocation.Version {
		fmt.Println(appVersion)
		return
	}

	fmt.Fprintf(os.Stderr, "%s: command is not implemented yet\n", invocation.Command)
	os.Exit(1)
}
