FROM --platform=$BUILDPLATFORM golang:1.27-alpine AS build
ARG TARGETOS TARGETARCH
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY cmd ./cmd
COPY internal ./internal
RUN CGO_ENABLED=0 GOOS=$TARGETOS GOARCH=$TARGETARCH go build -trimpath -ldflags="-s -w" -o /out/notifier ./cmd/notifier

FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build /out/notifier /notifier
ENTRYPOINT ["/notifier"]
CMD ["serve"]
