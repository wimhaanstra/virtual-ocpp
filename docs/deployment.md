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
  -e SESSION_SECRET=replace-with-at-least-32-random-characters \
  -e ADMIN_PASSWORD=replace-me-with-at-least-8-characters \
  -e OCPP_PUBLIC_URL=ws://localhost:3000/ocpp/:chargerId \
  virtual-ocpp:local
```

The container serves the API, OCPP websocket endpoint, and built frontend from one Fastify process on port `3000`.

## Docker Compose

Copy `docker-compose.example.yml` to your deployment host and replace the secrets before starting it:

```sh
docker compose -f docker-compose.example.yml up -d --build
```

The compose file mounts `/data` as a named volume. The default database path inside the image is `/data/virtual-ocpp.sqlite`.

## Required Environment

- `SESSION_SECRET`: at least 32 characters; signs the admin session cookie.
- `ADMIN_PASSWORD`: at least 8 characters; password for the local admin user.

Common optional values:

- `ADMIN_USERNAME`: defaults to `admin`.
- `OCPP_PUBLIC_URL`: URL template shown to operators and chargers, for example `wss://ocpp.example.com/ocpp/:chargerId`.
- `OCPP_BASIC_AUTH_PASSWORD`: requires chargers to use OCPP websocket Basic Auth where the username is the charger id.
- `COMMUNICATION_LOG_RETENTION_HOURS`: defaults to `24`.

## Reverse Proxy

Terminate TLS at your reverse proxy and forward websocket upgrades to the container. The proxy must preserve websocket upgrade headers for both:

- `/ocpp/:chargerId` for chargers.
- normal frontend/API traffic on `/`, `/api/*`, and `/health`.

When using TLS, set `OCPP_PUBLIC_URL` to a `wss://` URL so the dashboard shows the charger-facing address.

## Smoke Test

After the container starts:

```sh
curl http://localhost:3000/health
```

Open `http://localhost:3000` and sign in with `ADMIN_USERNAME` and `ADMIN_PASSWORD`.

For an end-to-end local OCPP smoke test from the repository checkout, run:

```sh
npm run simulator -- --url ws://localhost:3000/ocpp --charger-id SIM-001 --tag-id SIM-TAG-001 --ensure-tag
```
