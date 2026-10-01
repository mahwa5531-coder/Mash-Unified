# NexaU Cloud API — production image
# Multi-stage: hermetic build → minimal runtime (distroless-style via alpine).

# --- build stage -------------------------------------------------------------
FROM golang:1.25-alpine AS build

WORKDIR /src

# Cache-friendly dependency layer.
COPY go.mod go.sum ./
RUN go mod download

# Source layer.
COPY . .

# Hermetic, stripped, static build. CGO disabled: pgx + go-redis are pure Go.
# No -X ldflags: build-time variable injection is a no-op unless the symbol
# exists in main, and it is the wrong channel for secrets anyway (2026-09-19
# audit, finding 1 — the HS256 secret arrives at RUNTIME via the
# NEXAU_AUTH_HS256_SECRET env var or _FILE secret mount, never the image).
RUN CGO_ENABLED=0 GOFLAGS=-trimpath go build \
    -ldflags="-s -w" \
    -o /out/nexau-api ./cmd/server

# --- runtime stage -----------------------------------------------------------
FROM alpine:3.20

# Non-root runtime user; tini-style PID 1 via dumb-init is unnecessary for a
# single-process Go server that handles SIGTERM itself.
RUN addgroup -S nexau && adduser -S nexau -G nexau \
    && apk add --no-cache ca-certificates tzdata \
    && rm -rf /var/cache/apk/*

COPY --from=build /out/nexau-api /usr/local/bin/nexau-api

USER nexau
EXPOSE 8080

# Container-level liveness/readiness: the app exposes /health/*.
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=3 \
    CMD wget -q -O /dev/null http://127.0.0.1:8080/health/live || exit 1

ENTRYPOINT ["/usr/local/bin/nexau-api"]
