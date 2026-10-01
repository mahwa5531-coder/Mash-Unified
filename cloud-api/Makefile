# NexaU Cloud API — developer workflow
SHELL := /bin/bash
GO    ?= go

.PHONY: build test race vet bench fmt lint up down logs clean package validation validation-report loc

## build: compile server + loadtest binaries into ./bin
build:
	$(GO) build -trimpath -o bin/nexau-api ./cmd/server
	$(GO) build -trimpath -o bin/loadtest ./cmd/loadtest

## test: unit + e2e suites
test:
	$(GO) test ./...

## race: concurrency + data-race verification
race:
	$(GO) test -race -count=1 ./...

## vet: static analysis
vet:
	$(GO) vet ./...

## bench: hot-path benchmarks (validation, mapping, envelope)
bench:
	$(GO) test -run XXX -bench . -benchmem ./internal/agent/

## fmt: canonical formatting
fmt:
	$(GO) fmt ./...

## lint: fmt + vet + build gate
lint: fmt vet build

## up: full local stack (postgres, redis, bifrost, api)
up:
	docker compose up -d --build

## down: stop the stack (-v also drops volumes)
down:
	docker compose down

logs:
	docker compose logs -f api

## clean: remove build artifacts
clean:
	rm -rf bin

## validation: production validation suite (spec §1–§40) + report
validation:
	bash scripts/run_validation.sh

## validation-report: rerender the report from the last run
validation-report:
	python3 scripts/validation_report.py < build/validation.jsonl > VALIDATION_REPORT.md

## loc: line-count inventory by category
loc:
	@echo "production Go:   $$(find . -name '*.go' ! -name '*_test.go' -not -path './vendor/*' | xargs wc -l | tail -1 | awk '{print $$1}')"
	@echo "validation+e2e:  $$(find ./validation ./tests -name '*_test.go' | xargs wc -l | tail -1 | awk '{print $$1}')"
	@echo "package tests:   $$(find . -name '*_test.go' -not -path './validation/*' -not -path './tests/*' -not -path './vendor/*' | xargs wc -l | tail -1 | awk '{print $$1}')"
	@echo "SQL migrations:  $$(find . -name '*.sql' | xargs wc -l | tail -1 | awk '{print $$1}')"
	@echo "scripts:         $$(wc -l scripts/* | tail -1 | awk '{print $$1}')"
	@echo "docs:            $$(wc -l README.md docs/ARCHITECTURE.md VALIDATION_REPORT.md FILES.md 2>/dev/null | tail -1 | awk '{print $$1}')"

## package: source archive of the deliverable
package:
	git archive -o nexau-api-src.tar.gz HEAD 2>/dev/null || \
	tar --exclude=bin --exclude=.git -czf nexau-api-src.tar.gz .

help:
	@grep -E '^## ' $(MAKEFILE_LIST) | sed 's/## //' | column -t -s ':'
