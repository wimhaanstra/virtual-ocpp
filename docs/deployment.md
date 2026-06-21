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
  -p 3000:3000 \
  -v virtual-ocpp-data:/data \
  -e SESSION_SECRET="$SESSION_SECRET" \
  -e ADMIN_PASSWORD="$ADMIN_PASSWORD" \
  -e OCPP_PUBLIC_URL=ws://localhost:3000/ocpp/:chargerId \
  virtual-ocpp:local
```

The container serves the API, OCPP websocket endpoint, and built frontend from one Fastify process on port `3000`.
Set `SESSION_SECRET` and `ADMIN_PASSWORD` to real values before starting the container. Production startup rejects the placeholders from `.env.example` and `docker-compose.example.yml`.

## Docker Compose

The checked-in `docker-compose.example.yml` uses the same container image and mounts `/data` as a named volume:

```sh
docker compose -f docker-compose.example.yml up -d --build
```

Inside the image, the SQLite database defaults to `/data/virtual-ocpp.sqlite`.
Replace the example `SESSION_SECRET` and `ADMIN_PASSWORD` values before starting compose.

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

After the container starts:

```sh
curl http://localhost:3000/health
curl http://localhost:3000/ready
```

Open `http://localhost:3000` and sign in with `ADMIN_USERNAME` and `ADMIN_PASSWORD`.

For an end-to-end local OCPP smoke test from the repository checkout, run:

```sh
npm run simulator -- --url ws://localhost:3000/ocpp --charger-id SIM-001 --tag-id SIM-TAG-001 --ensure-tag
```
