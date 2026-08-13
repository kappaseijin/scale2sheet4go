package main

import (
	"context"
	"fmt"
	"os"

	"github.com/kappaseijin/scale2sheet4go/internal/cli"
)

func main() {
	invocation, err := cli.Parse(os.Args[1:])
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(cli.ExitCode(err))
	}
	if invocation.Help {
		os.Exit(cli.Run(context.Background(), invocation, cli.Output{Out: os.Stdout, Err: os.Stderr}))
	}
	os.Exit(cli.Run(context.Background(), invocation, cli.Output{Out: os.Stdout, Err: os.Stderr}))
}
