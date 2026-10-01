package config

import "runtime"

func runtimeNumCPU() int { return runtime.NumCPU() }
