# Deployment

## Docker Image

Build the production image from the repository root:

```sh
npm run docker:build
```

Run it with a persistent SQLite volume:

```sh
docker run --rm \
  --name virtual-ocpp \
  -p 8797:8797 \
  -v virtual-ocpp-data:/data \
  -e SESSION_SECRET="$SESSION_SECRET" \
  -e ADMIN_PASSWORD="$ADMIN_PASSWORD" \
  -e OCPP_PUBLIC_URL=ws://localhost:8797/ocpp/:chargerId \
  sortedbit/virtual-ocpp:latest
```

The container serves the API, OCPP websocket endpoint, and built frontend from one Fastify process on port `8797`.
Set `SESSION_SECRET` and `ADMIN_PASSWORD` to real values before starting the container. Production startup rejects the placeholders from `.env.example`.

To publish the image to Docker Hub as `sortedbit/virtual-ocpp`, make sure `docker login` has an active Docker Hub session and run:

```sh
npm run docker:publish
```

This uses Docker Buildx to build and push a multi-platform image for `linux/amd64` and `linux/arm64`.
It publishes both `sortedbit/virtual-ocpp:latest` and `sortedbit/virtual-ocpp:<package-version>` as multi-architecture manifest tags.
On Apple hardware, this is the publish command to use for Linux amd64 servers.

For a local amd64-only test image on Apple hardware, run:

```sh
npm run docker:build:amd64
```

## Docker Compose

Copy the example environment file, replace the placeholder secrets, and start the checked-in compose stack:

```sh
cp .env.example .env
docker compose pull
docker compose up -d
```

`docker-compose.yml` reads supported settings from `.env`, uses `sortedbit/virtual-ocpp:latest` by default, keeps the container internals fixed, and publishes the app on `http://localhost:8797`.
The container also listens on port `8797`, so Compose maps `8797:8797`.

Inside the image, SQLite is stored at `/data/virtual-ocpp.sqlite` and the built frontend is served from `/app/apps/web/dist`.
Override SQLite storage by changing the volume mount, for example by replacing the named volume with a bind mount to `/data`.

## Required Environment

- `SESSION_SECRET`: at least 32 characters; signs the admin session cookie.
- `ADMIN_PASSWORD`: must not be empty; password for the local admin user.

Common optional values:

- `ADMIN_USERNAME`: defaults to `admin`.
- `OCPP_PUBLIC_URL`: charger-facing websocket URL, for example `wss://ocpp.example.com/ocpp/:chargerId`.
- `OCPP_BASIC_AUTH_PASSWORD`: requires chargers to use OCPP websocket Basic Auth with the charger id as username.
- `COMMUNICATION_LOG_RETENTION_HOURS`: defaults to `24`.
- `CHARGER_SILENT_AFTER_SECONDS`: defaults to `300`.
- `METER_GAP_THRESHOLD_WH`: defaults to `1000`.

## Reverse Proxy

Terminate TLS at your reverse proxy and forward websocket upgrades to the container. Preserve upgrade headers for:

- `/ocpp/:chargerId` for chargers
- `/`, `/api/*`, and `/health` for the web UI and API

If the public charger URL uses TLS, set `OCPP_PUBLIC_URL` to a `wss://` value so the dashboard shows the correct charger-facing address.

The application serves the UI, API, live updates, and OCPP charger websocket endpoint from the same internal port, `8797`. A reverse proxy should route the whole host to container port `8797`; it does not need a separate websocket service or path-specific backend.

## Traefik

Use `docker-compose.traefik.example.yml` as an override when the base `docker-compose.yml` is synced read-only. It adds Traefik labels and attaches the app to an external Traefik network.

Add these values to `.env`:

```env
OCPP_PUBLIC_URL=wss://ocpp.example.com/ocpp/:chargerId
VIRTUAL_OCPP_HOST=ocpp.example.com
TRAEFIK_ENTRYPOINT=websecure
TRAEFIK_CERT_RESOLVER=letsencrypt
TRAEFIK_NETWORK=traefik
```

Then start the stack with both compose files:

```sh
docker compose -f docker-compose.yml -f docker-compose.traefik.example.yml pull
docker compose -f docker-compose.yml -f docker-compose.traefik.example.yml up -d
```

The override creates a single router for `Host(${VIRTUAL_OCPP_HOST})` and points Traefik at service port `8797`. Traefik handles websocket upgrades automatically when it forwards HTTP/1.1 requests, so `/ocpp/:chargerId` works through the same router as the admin interface.

Traefik normally sets `X-Forwarded-Proto`. Virtual OCPP uses that header to mark admin session cookies as `Secure` when requests arrive over HTTPS. If you use another proxy, make sure it forwards `X-Forwarded-Proto: https` for TLS traffic.

If Traefik uses a different external Docker network, set `TRAEFIK_NETWORK` to that network name. If your certificate resolver or entrypoint has a different name, set `TRAEFIK_CERT_RESOLVER` or `TRAEFIK_ENTRYPOINT` accordingly.

## Health And Smoke Test

`/health` reports that the process is running. `/ready` also verifies database access and is used by the Docker healthcheck.

After the container or Compose stack starts:

```sh
curl http://localhost:8797/health
curl http://localhost:8797/ready
```

Open `http://localhost:8797` and sign in with `ADMIN_USERNAME` and `ADMIN_PASSWORD`.

For an end-to-end local OCPP smoke test from the repository checkout, run:

```sh
ADMIN_PASSWORD="$ADMIN_PASSWORD" npm run smoke:simulator -- --url ws://localhost:8797/ocpp
```

The smoke command connects charger `SMOKE-001`, creates and grants tag `SMOKE-TAG-001`, starts a short charging session, sends meter values, and exits after `StopTransaction`.
