# MASh Cloud API — developer workflow
SHELL := /bin/bash
GO    ?= go

.PHONY: build test race vet fmt lint up down logs clean loc package

## build: compile the server binary into ./bin
build:
	$(GO) build -trimpath -o bin/mash-api ./cmd/server

## test: unit + integration suites
test:
	$(GO) test ./...

## race: concurrency + data-race verification
race:
	$(GO) test -race -count=1 ./...

## vet: static analysis
vet:
	$(GO) vet ./...

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

## loc: line-count inventory by category
loc:
	@echo "production Go:   $$(find . -name '*.go' ! -name '*_test.go' -not -path './vendor/*' | xargs wc -l | tail -1 | awk '{print $$1}')"
	@echo "integration:     $$(find ./tests -name '*_test.go' | xargs wc -l | tail -1 | awk '{print $$1}')"
	@echo "package tests:   $$(find . -name '*_test.go' ! -path './tests/*' -not -path './vendor/*' | xargs wc -l | tail -1 | awk '{print $$1}')"
	@echo "SQL migrations:  $$(find . -name '*.sql' | xargs wc -l | tail -1 | awk '{print $$1}')"
	@echo "docs:            $$(find docs -name '*.md' | xargs wc -l | tail -1 | awk '{print $$1}')"

## package: source archive of the deliverable
package:
	git archive -o mash-api-src.tar.gz HEAD 2>/dev/null || \
	tar --exclude=bin --exclude=.git -czf mash-api-src.tar.gz .

help:
	@grep -E '^## ' $(MAKEFILE_LIST) | sed 's/## //' | column -t -s ':'
