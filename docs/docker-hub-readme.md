# Virtual OCPP

Self-hosted OCPP 1.6j gateway and proxy for Smart EVSE chargers.

Virtual OCPP runs the admin UI, API, and charger websocket endpoint from one container on port `8797`. It stores data in SQLite at `/data/virtual-ocpp.sqlite`.

## Links

- GitHub repository: https://github.com/wimhaanstra/virtual-ocpp
- Deployment documentation: https://github.com/wimhaanstra/virtual-ocpp/blob/main/docs/deployment.md
- Configuration reference: https://github.com/wimhaanstra/virtual-ocpp#environment-variables
- Issues: https://github.com/wimhaanstra/virtual-ocpp/issues

## Quick Start

```yaml
services:
  virtual-ocpp:
    image: wimhaanstra/virtual-ocpp:latest
    restart: unless-stopped
    environment:
      SESSION_SECRET: replace-with-at-least-32-random-characters
      ADMIN_PASSWORD: replace-me
      # Optional admin username. Defaults to admin.
      # ADMIN_USERNAME: admin
      # Optional charger-facing websocket URL shown in the UI. Set this to your host, IP, or reverse-proxy URL.
      # OCPP_PUBLIC_URL: ws://YOUR_HOST_OR_IP:8797/ocpp/:chargerId
      # Optional charger Basic Auth password. When set, chargers must use their charger id as username.
      # OCPP_BASIC_AUTH_PASSWORD: charger-password
      # Optional number of hours to keep redacted communication journal rows.
      # COMMUNICATION_LOG_RETENTION_HOURS: "24"
      # Optional number of seconds before a charger is considered silent.
      # CHARGER_SILENT_AFTER_SECONDS: "300"
      # Optional minimum meter gap in Wh before offline recovery suggestions are created.
      # METER_GAP_THRESHOLD_WH: "1000"
    ports:
      - "8797:8797"
    volumes:
      - virtual-ocpp-data:/data

volumes:
  virtual-ocpp-data:
```

After starting the container, open `http://YOUR_HOST_OR_IP:8797` and sign in with `ADMIN_USERNAME` and `ADMIN_PASSWORD`.

## Required Configuration

- `SESSION_SECRET`: at least 32 characters; signs admin session cookies.
- `ADMIN_PASSWORD`: local admin password; must not be empty.

For reverse proxy, TLS, storage override, Traefik, and smoke-test details, use the deployment documentation linked above.
