# Deployment

## Docker Image

Build the production image from the repository root:

```sh
docker build -t virtual-ocpp:local .
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
  virtual-ocpp:local
```

The container serves the API, OCPP websocket endpoint, and built frontend from one Fastify process on port `8797`.
Set `SESSION_SECRET` and `ADMIN_PASSWORD` to real values before starting the container. Production startup rejects the placeholders from `.env.example`.

## Docker Compose

Copy the example environment file, replace the placeholder secrets, and start the checked-in compose stack:

```sh
cp .env.example .env
docker compose up -d --build
```

`docker-compose.yml` reads supported settings from `.env`, keeps the container internals fixed, and publishes the app on `http://localhost:8797`.
The container also listens on port `8797`, so Compose maps `8797:8797`.

Inside the image, SQLite is stored at `/data/virtual-ocpp.sqlite` and the built frontend is served from `/app/apps/web/dist`.
Override SQLite storage by changing the volume mount, for example by replacing the named volume with a bind mount to `/data`.

## Required Environment

- `SESSION_SECRET`: at least 32 characters; signs the admin session cookie.
- `ADMIN_PASSWORD`: at least 8 characters; password for the local admin user.

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
