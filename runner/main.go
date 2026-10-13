// r00tvpn runner: started by the elevated "r00tvpn-run" scheduled task, it
// launches the app (path in argv[1]) so the app inherits admin rights without a
// UAC prompt. The app leaves its launch arguments in param.txt next to this exe.
//
// SPDX-License-Identifier: GPL-3.0-only

//go:build windows

package main

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"unsafe"
)

const (
	title     = "r00tvpn Runner"
	paramFile = "param.txt"
)

func main() {
	if err := launch(os.Args[1:]); err != nil {
		alert(err.Error())
		os.Exit(1)
	}
}

func launch(args []string) error {
	if len(args) != 1 {
		return fmt.Errorf("usage: %s <path to app executable>", filepath.Base(os.Args[0]))
	}
	app := args[0]

	self, err := os.Executable()
	if err != nil {
		return err
	}
	// A missing file just means no arguments to forward
	param, _ := os.ReadFile(filepath.Join(filepath.Dir(self), paramFile))

	cmd := exec.Command(app, strings.TrimSpace(string(param)))
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("failed to start %s:\n%v\n\nTry running the app as administrator.", app, err)
	}
	return cmd.Process.Release()
}

func alert(msg string) {
	const mbIconError = 0x10
	text, _ := syscall.UTF16PtrFromString(msg)
	caption, _ := syscall.UTF16PtrFromString(title)
	syscall.NewLazyDLL("user32.dll").NewProc("MessageBoxW").Call(
		0, uintptr(unsafe.Pointer(text)), uintptr(unsafe.Pointer(caption)), mbIconError)
}
