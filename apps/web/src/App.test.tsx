import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "./App";

type TestTag = {
  id: string;
  uuid: string;
  label: string | null;
  enabled: boolean;
  createdAt: string;
  chargerAccess?: Array<{ chargerId: string; enabled: boolean; updatedAt?: string }>;
};

type TestChargerRegistryRow = {
  id: string;
  chargerId?: string | null;
  label?: string | null;
  active?: boolean;
  connectedAt?: string | null;
  disconnectedAt?: string | null;
  lastSeenAt?: string | null;
  updatedAt?: string | null;
};

type TestProxyTarget = {
  id: string;
  name: string;
  url: string;
  chargerId?: string;
  stationId: string | null;
  enabled: boolean;
  mode: "monitor-only" | "deny-capable";
  outagePolicy: "fail-open" | "fail-closed";
  hasUsername: boolean;
  hasBasicAuthPassword: boolean;
  tagMappings?: Array<{ id?: string; localIdTag: string; outboundIdTag: string }>;
  createdAt: string;
  updatedAt: string;
};

type TestCommunicationJournalItem = {
  id: string;
  createdAt: string;
  direction: "inbound" | "outbound";
  sourceType: string;
  sourceId: string;
  targetType: string;
  targetId: string;
  chargerId: string | null;
  proxyTargetId: string | null;
  messageType: string;
  ocppMethod: string | null;
  transactionId: number | null;
  idTag: string | null;
  payload: unknown;
  errorCode: string | null;
  errorDescription: string | null;
  correlationId: string | null;
};

const emptyVisibilityResponses = (url: string, method: string) => {
  const path = new URL(url, "http://localhost").pathname;

  if (path === "/api/dashboard-config" && method === "GET") {
    return new Response(
      JSON.stringify({
        ocppWebSocketUrl: "ws://localhost:3000/ocpp/:chargerId",
        ocppProtocol: "ocpp1.6",
        ocppBasicAuthRequired: false,
        ocppBasicAuthUsername: null
      }),
      { status: 200 }
    );
  }

  if (
    (path === "/api/chargers" ||
      path === "/api/charger-connections" ||
      path === "/api/sessions" ||
      path === "/api/charging-stats" ||
      path === "/api/logs") &&
    method === "GET"
  ) {
    return new Response(JSON.stringify([]), { status: 200 });
  }

  if (path === "/api/communication-journal" && method === "GET") {
    return new Response(JSON.stringify({ items: [], retentionHours: 24 }), { status: 200 });
  }

  if (path === "/api/proxy-health" && method === "GET") {
    return new Response(
      JSON.stringify({
        chargerId: null,
        summary: { total: 0, connected: 0, backoff: 0, waitingForCharger: 0, disabled: 0 },
        targets: []
      }),
      { status: 200 }
    );
  }

  if (path === "/api/active-session-audit" && method === "GET") {
    return new Response(JSON.stringify({ summary: { activeSessions: 0, flaggedSessions: 0 }, items: [] }), { status: 200 });
  }

  if ((path === "/api/live-updates" || path === "/api/events") && method === "GET") {
    return new Response("", {
      status: 404
    });
  }

  return null;
};

describe("App", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    window.localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
    window.history.replaceState({}, "", "/");
  });

  it("protects the interface behind admin login", () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 }))
    );

    render(<App />);

    expect(screen.getByText("Virtual OCPP")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Sign in" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Proxy targets" })).not.toBeInTheDocument();
  });

  it("shows the home dashboard with charger connection guidance after authentication", async () => {
    window.history.replaceState({}, "", "/?chargerId=SMART-EVSE-1");

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";

      if (url === "/api/auth/session") {
        return new Response(JSON.stringify({ authenticated: true, username: "admin" }), { status: 200 });
      }

      if (url.startsWith("/api/tags") && method === "GET") {
        return new Response(
          JSON.stringify([
            {
              id: "tag-1",
              uuid: "04A1B2C3",
              label: "Main RFID",
              enabled: true,
              createdAt: "2026-06-19T08:00:00.000Z"
            }
          ]),
          { status: 200 }
        );
      }

      if (url.startsWith("/api/proxy-targets") && method === "GET") {
        return new Response(
          JSON.stringify([
            {
              id: "proxy-1",
              name: "Tap Electric",
              url: "wss://tap.example/ocpp",
              stationId: "STATION-1",
              enabled: true,
              mode: "deny-capable",
              outagePolicy: "fail-closed",
              hasUsername: true,
              hasBasicAuthPassword: true,
              createdAt: "2026-06-19T08:00:00.000Z",
              updatedAt: "2026-06-19T08:00:00.000Z"
            }
          ]),
          { status: 200 }
        );
      }

      if (url.startsWith("/api/proxy-health") && method === "GET") {
        return new Response(
          JSON.stringify({
            chargerId: "SMART-EVSE-1",
            summary: { total: 1, connected: 1, backoff: 0, waitingForCharger: 0, disabled: 0 },
            targets: [
              {
                proxyTargetId: "proxy-1",
                name: "Tap Electric",
                chargerId: "SMART-EVSE-1",
                enabled: true,
                mode: "deny-capable",
                outagePolicy: "fail-closed",
                connected: true,
                state: "connected",
                detail: "Persistent upstream socket is open.",
                upstreamIdentity: "STATION-1",
                hadSuccessfulConnection: true,
                lastConnectedAt: "2026-06-19T09:55:00.000Z",
                lastDisconnectedAt: null,
                lastSuccessAt: "2026-06-19T10:01:00.000Z",
                lastFailureAt: null,
                nextReconnectAt: null,
                lastErrorCode: null
              }
            ]
          }),
          { status: 200 }
        );
      }

      if (url.startsWith("/api/active-session-audit") && method === "GET") {
        return new Response(JSON.stringify({ summary: { activeSessions: 1, flaggedSessions: 0 }, items: [] }), { status: 200 });
      }

      if (url === "/api/dashboard-config" && method === "GET") {
        return new Response(
          JSON.stringify({
            ocppWebSocketUrl: "ws://localhost:3000/ocpp/:chargerId",
            ocppProtocol: "ocpp1.6",
            ocppBasicAuthRequired: true,
            ocppBasicAuthUsername: "charger id"
          }),
          { status: 200 }
        );
      }

      if (url.startsWith("/api/sessions") && method === "GET") {
        return new Response(
          JSON.stringify([
            {
              id: "session-1",
              chargerId: "SMART-EVSE-1",
              connectorId: 1,
              transactionId: 42,
              idTag: "TAG-1",
              startedAt: "2026-06-19T09:05:00.000Z",
              stoppedAt: null,
              startMeterWh: 1000,
              stopMeterWh: null,
              stopReason: null,
              status: "active",
              active: true
            }
          ]),
          { status: 200 }
        );
      }

      if (url.startsWith("/api/charging-stats") && method === "GET") {
        return new Response(
          JSON.stringify([
            {
              sessionId: "session-1",
              chargerId: "SMART-EVSE-1",
              connectorId: 1,
              transactionId: 42,
              idTag: "TAG-1",
              startedAt: "2026-06-19T09:05:00.000Z",
              elapsedSeconds: 1860,
              startMeterWh: 1000,
              latestMeterWh: 2650,
              energyUsedWh: 1650,
              latestPowerW: 7200,
              latestCurrentA: 31.3,
              latestVoltageV: 230,
              latestSampleAt: "2026-06-19T09:36:00.000Z",
              latestEnergyContext: "Sample.Periodic",
              latestPowerContext: "Sample.Periodic"
            }
          ]),
          { status: 200 }
        );
      }

      if (url === "/api/chargers" && method === "GET") {
        return new Response(
          JSON.stringify([
            {
              id: "SMART-EVSE-1",
              label: null,
              lastSeenAt: "2026-06-19T09:00:00.000Z",
              connectedAt: "2026-06-19T09:00:00.000Z",
              disconnectedAt: null,
              active: true
            },
            {
              id: "SMART-EVSE-2",
              label: null,
              lastSeenAt: "2026-06-19T08:30:00.000Z",
              connectedAt: null,
              disconnectedAt: null,
              active: false
            }
          ]),
          { status: 200 }
        );
      }

      if (url.startsWith("/api/logs") && method === "GET") {
        return new Response(
          JSON.stringify([
            {
              id: "log-1",
              level: "info",
              category: "proxy",
              message: "proxy target disconnected",
              chargerId: "SMART-EVSE-1",
              transactionId: null,
              createdAt: "2026-06-19T10:00:00.000Z",
              hasMetadata: true,
              context: {
                proxyTargetId: "proxy-1"
              }
            }
          ]),
          { status: 200 }
        );
      }

      if (url.startsWith("/api/communication-journal") && method === "GET") {
        return new Response(JSON.stringify({ items: [], retentionHours: 24 }), { status: 200 });
      }

      const fallbackResponse = emptyVisibilityResponses(url, method);
      if (fallbackResponse) return fallbackResponse;
      throw new Error(`Unexpected request: ${url}`);
    });

    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    expect(await screen.findByRole("heading", { name: "Home dashboard" })).toBeInTheDocument();
    expect(screen.getByText(/Live|Connecting|Stale/, { selector: ".live-indicator" })).toBeInTheDocument();
    expect(screen.getByText("ws://localhost:3000/ocpp/:chargerId")).toBeInTheDocument();
    expect(screen.getByText("Use wss:// when this service is served behind TLS.")).toBeInTheDocument();
    expect(screen.getByText("ocpp1.6")).toBeInTheDocument();
    expect(screen.getByText(/Basic Auth is required\. Use the charger id as the username\./)).toBeInTheDocument();
    expect(screen.getByText(/Secrets are never shown in this dashboard\./)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Charger connection" })).toBeInTheDocument();
    expect(within(screen.getByLabelText("Dashboard quick links")).getByRole("button", { name: "Communication" })).toBeInTheDocument();
    expect(within(screen.getByLabelText("Dashboard quick links")).getByRole("button", { name: "Sessions" })).toBeInTheDocument();
    expect(within(screen.getByLabelText("Dashboard quick links")).getByRole("button", { name: "Proxy targets" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Operational snapshot" })).not.toBeInTheDocument();
    expect(screen.queryByText("Chargers connected now")).not.toBeInTheDocument();
    expect(screen.queryByText("Recent registry rows")).not.toBeInTheDocument();
    expect(screen.queryByText("Enabled tags")).not.toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "Transaction 42" })).toBeInTheDocument();
    expect(screen.getByText("1.65 kWh")).toBeInTheDocument();
    expect(screen.getByText("7.2 kW")).toBeInTheDocument();
    expect(screen.getByText("31.3 A")).toBeInTheDocument();
    expect(screen.getByText("230 V")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Upstream targets" })).toBeInTheDocument();
    expect(screen.getByText("wss://tap.example/ocpp/STATION-1")).toBeInTheDocument();
    expect(screen.getAllByText("Connected").length).toBeGreaterThan(0);
    expect(screen.getByText(/Persistent upstream socket is open\./)).toBeInTheDocument();
    expect(screen.getAllByText("SMART-EVSE-1").length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: "Activity" })).not.toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([input]) => String(input).startsWith("/api/proxy-health?chargerId=SMART-EVSE-1"))).toBe(true);
  });

  it("refreshes charger-scoped slices from live updates when the event stream is available", async () => {
    const chargerId = "SMART-EVSE-1";
    let latestPowerW = 7200;
    let latestSampleAt = "2026-06-19T09:36:00.000Z";

    class FakeEventSource {
      static instances: FakeEventSource[] = [];
      readonly url: string;
      readonly listeners = new Map<string, Set<(event: Event) => void>>();
      onopen: ((event: Event) => void) | null = null;
      onerror: ((event: Event) => void) | null = null;

      constructor(url: string) {
        this.url = url;
        FakeEventSource.instances.push(this);
        queueMicrotask(() => {
          this.onopen?.(new Event("open"));
          this.listeners.get("open")?.forEach((listener) => listener(new Event("open")));
        });
      }

      addEventListener(type: string, listener: (event: Event) => void) {
        const listeners = this.listeners.get(type) ?? new Set();
        listeners.add(listener);
        this.listeners.set(type, listeners);
      }

      removeEventListener(type: string, listener: (event: Event) => void) {
        this.listeners.get(type)?.delete(listener);
      }

      emit(data: unknown, type = "message") {
        const event = new MessageEvent(type, { data: JSON.stringify(data) });
        if (type === "message") {
          this.listeners.get("message")?.forEach((listener) => listener(event));
        }
        this.listeners.get(type)?.forEach((listener) => listener(event));
      }

      close() {
        this.listeners.clear();
      }
    }

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      const parsedUrl = new URL(url, "http://localhost");
      const path = parsedUrl.pathname;

      if (path === "/api/auth/session") {
        return new Response(JSON.stringify({ authenticated: true, username: "admin" }), { status: 200 });
      }

      if (path === "/api/live-updates" && method === "GET") {
        return new Response("", {
          status: 200,
          headers: {
            "content-type": "text/event-stream"
          }
        });
      }

      if (path === "/api/chargers" && method === "GET") {
        return new Response(
          JSON.stringify([
            {
              id: "SMART-EVSE-1",
              label: null,
              lastSeenAt: "2026-06-19T09:00:00.000Z",
              connectedAt: "2026-06-19T09:00:00.000Z",
              disconnectedAt: null,
              active: true
            }
          ]),
          { status: 200 }
        );
      }

      if (path === "/api/dashboard-config" && method === "GET") {
        return emptyVisibilityResponses(url, method)!;
      }

      if (path === "/api/tags" && method === "GET") {
        return new Response(JSON.stringify([]), { status: 200 });
      }

      if (path === "/api/proxy-targets" && method === "GET") {
        return new Response(JSON.stringify([]), { status: 200 });
      }

      if (path === "/api/proxy-health" && method === "GET") {
        return new Response(
          JSON.stringify({
            chargerId,
            summary: { total: 0, connected: 0, backoff: 0, waitingForCharger: 0, disabled: 0 },
            targets: []
          }),
          { status: 200 }
        );
      }

      if (path === "/api/active-session-audit" && method === "GET") {
        return new Response(JSON.stringify({ summary: { activeSessions: 1, flaggedSessions: 0 }, items: [] }), { status: 200 });
      }

      if (path === "/api/sessions" && method === "GET") {
        return new Response(JSON.stringify([]), { status: 200 });
      }

      if (path === "/api/charging-stats" && method === "GET") {
        return new Response(
          JSON.stringify([
            {
              sessionId: "session-1",
              chargerId,
              connectorId: 1,
              transactionId: 42,
              idTag: "TAG-1",
              startedAt: "2026-06-19T09:05:00.000Z",
              elapsedSeconds: 1860,
              startMeterWh: 1000,
              latestMeterWh: 2650,
              energyUsedWh: 1650,
              latestPowerW,
              latestCurrentA: 31.3,
              latestVoltageV: 230,
              latestSampleAt,
              latestEnergyContext: "Sample.Periodic",
              latestPowerContext: "Sample.Periodic"
            }
          ]),
          { status: 200 }
        );
      }

      if (path === "/api/logs" && method === "GET") {
        return new Response(JSON.stringify([]), { status: 200 });
      }

      if (path === "/api/communication-journal" && method === "GET") {
        return new Response(JSON.stringify({ items: [], retentionHours: 24 }), { status: 200 });
      }

      const fallbackResponse = emptyVisibilityResponses(url, method);
      if (fallbackResponse) return fallbackResponse;
      throw new Error(`Unexpected request: ${url}`);
    });

    vi.stubGlobal("EventSource", FakeEventSource as unknown as typeof EventSource);
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    expect(await screen.findByRole("heading", { name: "Home dashboard" })).toBeInTheDocument();
    expect(await screen.findByText("Live", { selector: ".live-indicator" })).toBeInTheDocument();
    expect(screen.getByText("7.2 kW")).toBeInTheDocument();

    latestPowerW = 4200;
    latestSampleAt = "2026-06-19T09:46:00.000Z";

    const liveEvent = FakeEventSource.instances[0];
    expect(liveEvent).toBeDefined();
    await act(async () => {
      liveEvent.emit(
        {
          id: "evt-1",
          occurredAt: "2026-06-19T09:46:01.000Z",
          event: {
            type: "meter.sample.recorded",
            chargerId
          }
        },
        "live-update"
      );
    });

    await screen.findByText("4.2 kW");
    expect(
      fetchMock.mock.calls.filter(([input]) => {
        const url = new URL(String(input), "http://localhost");
        return url.pathname === "/api/charging-stats";
      }).length
    ).toBeGreaterThan(1);
  });

  it("keeps the current page in the URL and restores it on browser back", async () => {
    window.history.replaceState({}, "", "/proxy-targets?chargerId=SMART-EVSE-1");

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      const parsedUrl = new URL(url, "http://localhost");
      const path = parsedUrl.pathname;

      if (path === "/api/auth/session") {
        return new Response(JSON.stringify({ authenticated: true, username: "admin" }), { status: 200 });
      }

      if (path === "/api/dashboard-config" && method === "GET") {
        return emptyVisibilityResponses(url, method)!;
      }

      if (path === "/api/chargers" && method === "GET") {
        return new Response(
          JSON.stringify([
            {
              id: "SMART-EVSE-1",
              label: "Bay 1",
              active: true,
              connectedAt: "2026-06-19T09:00:00.000Z",
              disconnectedAt: null,
              lastSeenAt: "2026-06-19T10:00:00.000Z"
            }
          ]),
          { status: 200 }
        );
      }

      if (path === "/api/tags" && method === "GET") {
        return new Response(JSON.stringify([]), { status: 200 });
      }

      if (path === "/api/proxy-targets" && method === "GET") {
        return new Response(JSON.stringify([]), { status: 200 });
      }

      if (path === "/api/sessions" && method === "GET") {
        return new Response(JSON.stringify([]), { status: 200 });
      }

      if (path === "/api/logs" && method === "GET") {
        return new Response(JSON.stringify([]), { status: 200 });
      }

      if (path === "/api/communication-journal" && method === "GET") {
        return new Response(JSON.stringify({ items: [], retentionHours: 24 }), { status: 200 });
      }

      const fallbackResponse = emptyVisibilityResponses(url, method);
      if (fallbackResponse) return fallbackResponse;
      throw new Error(`Unexpected request: ${url}`);
    });

    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    expect(await screen.findByRole("heading", { name: "Proxy targets" })).toBeInTheDocument();
    expect(screen.getByLabelText("Charger context")).toHaveValue("SMART-EVSE-1");

    const sidebar = within(screen.getByRole("complementary", { name: "Main navigation" }));
    fireEvent.click(sidebar.getByRole("button", { name: "Tags" }));

    await waitFor(() => expect(window.location.pathname).toBe("/tags"));
    expect(window.location.search).toBe("?chargerId=SMART-EVSE-1");
    expect(screen.getByRole("heading", { name: "Tags" })).toBeInTheDocument();

    window.history.back();

    await waitFor(() => expect(window.location.pathname).toBe("/proxy-targets"));
    expect(window.location.search).toBe("?chargerId=SMART-EVSE-1");
    expect(screen.getByRole("heading", { name: "Proxy targets" })).toBeInTheDocument();
  });

  it("persists theme and sidebar shell preferences", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      const parsedUrl = new URL(url, "http://localhost");

      if (parsedUrl.pathname === "/api/auth/session") {
        return new Response(JSON.stringify({ authenticated: true, username: "admin" }), { status: 200 });
      }

      const visibilityResponse = emptyVisibilityResponses(url, method);
      if (visibilityResponse) return visibilityResponse;

      if (parsedUrl.pathname === "/api/tags" && method === "GET") {
        return new Response(JSON.stringify([]), { status: 200 });
      }

      if (parsedUrl.pathname === "/api/proxy-targets" && method === "GET") {
        return new Response(JSON.stringify([]), { status: 200 });
      }

      const fallbackResponse = emptyVisibilityResponses(url, method);
      if (fallbackResponse) return fallbackResponse;
      throw new Error(`Unexpected request: ${url}`);
    });

    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    expect(await screen.findByRole("heading", { name: "Home dashboard" })).toBeInTheDocument();
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe("dark"));

    fireEvent.click(screen.getByRole("button", { name: "Switch to light mode" }));
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(window.localStorage.getItem("virtual-ocpp-theme")).toBe("light");

    const sidebar = within(screen.getByRole("complementary", { name: "Main navigation" }));
    fireEvent.click(sidebar.getByRole("button", { name: "Collapse sidebar" }));
    expect(window.localStorage.getItem("virtual-ocpp-sidebar-collapsed")).toBe("true");
    expect(sidebar.getByRole("button", { name: "Expand sidebar" })).toBeInTheDocument();
    expect(sidebar.getByRole("button", { name: "Dashboard" })).toHaveAttribute("title", "Dashboard");
  });

  it("shows communication journal rows after authentication", async () => {
    const journalRows: TestCommunicationJournalItem[] = [
      {
        id: "journal-1",
        createdAt: "2026-06-19T10:15:00.000Z",
        direction: "inbound",
        sourceType: "charger",
        sourceId: "SMART-EVSE-1",
        targetType: "server",
        targetId: "server",
        chargerId: "SMART-EVSE-1",
        proxyTargetId: null,
        messageType: "call",
        ocppMethod: "BootNotification",
        transactionId: null,
        idTag: null,
        payload: {
          chargePointVendor: "Smart EVSE",
          chargePointModel: "SE-11",
          authorization: "[redacted]"
        },
        errorCode: null,
        errorDescription: null,
        correlationId: "corr-1"
      }
    ];

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";

      if (url === "/api/auth/session") {
        return new Response(JSON.stringify({ authenticated: true, username: "admin" }), { status: 200 });
      }

      if (url === "/api/tags" && method === "GET") {
        return new Response(JSON.stringify([]), { status: 200 });
      }

      if (url === "/api/proxy-targets" && method === "GET") {
        return new Response(
          JSON.stringify([
            {
              id: "proxy-1",
              name: "Tap Electric",
              url: "wss://tap.example/ocpp",
              stationId: "STATION-1",
              enabled: true,
              mode: "deny-capable",
              outagePolicy: "fail-closed",
              hasUsername: true,
              hasBasicAuthPassword: true,
              createdAt: "2026-06-19T08:00:00.000Z",
              updatedAt: "2026-06-19T08:00:00.000Z"
            }
          ]),
          { status: 200 }
        );
      }

      if (url === "/api/dashboard-config" && method === "GET") {
        return emptyVisibilityResponses(url, method)!;
      }

      if (url === "/api/sessions" && method === "GET") {
        return new Response(JSON.stringify([]), { status: 200 });
      }

      if (url === "/api/chargers" && method === "GET") {
        return new Response(JSON.stringify([]), { status: 200 });
      }

      if (url === "/api/logs" && method === "GET") {
        return new Response(JSON.stringify([]), { status: 200 });
      }

      if (url.startsWith("/api/communication-journal") && method === "GET") {
        return new Response(JSON.stringify({ items: journalRows, retentionHours: 24 }), { status: 200 });
      }

      const fallbackResponse = emptyVisibilityResponses(url, method);
      if (fallbackResponse) return fallbackResponse;
      throw new Error(`Unexpected request: ${url}`);
    });

    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    expect(await screen.findByRole("heading", { name: "Home dashboard" })).toBeInTheDocument();

    const sidebar = within(screen.getByRole("complementary", { name: "Main navigation" }));
    fireEvent.click(sidebar.getByRole("button", { name: "Communication" }));

    expect(await screen.findByRole("heading", { name: "Communication" })).toBeInTheDocument();
    expect(screen.getByText(/Showing the last 24 hours by default, newest first, limit 200\./)).toBeInTheDocument();
    expect(screen.getByText("BootNotification")).toBeInTheDocument();
    expect(screen.getByText("SMART-EVSE-1")).toBeInTheDocument();
  });

  it("issues communication journal filters as query parameters", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";

      if (url === "/api/auth/session") {
        return new Response(JSON.stringify({ authenticated: true, username: "admin" }), { status: 200 });
      }

      if (url === "/api/tags" && method === "GET") {
        return new Response(JSON.stringify([]), { status: 200 });
      }

      if (url === "/api/proxy-targets" && method === "GET") {
        return new Response(JSON.stringify([]), { status: 200 });
      }

      if (url === "/api/dashboard-config" && method === "GET") {
        return emptyVisibilityResponses(url, method)!;
      }

      if (url === "/api/sessions" && method === "GET") {
        return new Response(JSON.stringify([]), { status: 200 });
      }

      if (url === "/api/chargers" && method === "GET") {
        return new Response(JSON.stringify([]), { status: 200 });
      }

      if (url === "/api/logs" && method === "GET") {
        return new Response(JSON.stringify([]), { status: 200 });
      }

      if (url.startsWith("/api/communication-journal") && method === "GET") {
        return new Response(JSON.stringify({ items: [], retentionHours: 24 }), { status: 200 });
      }

      const fallbackResponse = emptyVisibilityResponses(url, method);
      if (fallbackResponse) return fallbackResponse;
      throw new Error(`Unexpected request: ${url}`);
    });

    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    expect(await screen.findByRole("heading", { name: "Home dashboard" })).toBeInTheDocument();

    const sidebar = within(screen.getByRole("complementary", { name: "Main navigation" }));
    fireEvent.click(sidebar.getByRole("button", { name: "Communication" }));

    fireEvent.change(screen.getByLabelText("Source type"), { target: { value: "charger" } });
    fireEvent.change(screen.getByLabelText("From"), { target: { value: "2026-06-19T08:00" } });
    fireEvent.change(screen.getByLabelText("To"), { target: { value: "2026-06-19T12:00" } });
    fireEvent.change(screen.getByLabelText("Source id"), { target: { value: "SMART-EVSE-1" } });
    fireEvent.change(screen.getByLabelText("Target type"), { target: { value: "server" } });
    fireEvent.change(screen.getByLabelText("Target id"), { target: { value: "server" } });
    fireEvent.change(screen.getByLabelText("Charger id"), { target: { value: "SMART-EVSE-1" } });
    fireEvent.change(screen.getByLabelText("Proxy target id"), { target: { value: "proxy-1" } });
    fireEvent.change(screen.getByLabelText("OCPP method"), { target: { value: "BootNotification" } });
    fireEvent.change(screen.getByLabelText("Message type"), { target: { value: "call" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply filters" }));

    await waitFor(() => {
      expect(fetchMock.mock.calls.filter(([input]) => String(input).startsWith("/api/communication-journal?")).length).toBeGreaterThan(1);
    });

    const filteredCalls = fetchMock.mock.calls.filter(([input]) => String(input).startsWith("/api/communication-journal?"));
    const filteredCall = filteredCalls[filteredCalls.length - 1];
    expect(filteredCall).toBeDefined();

    const filteredUrl = new URL(String(filteredCall?.[0]), "http://localhost");
    expect(filteredUrl.searchParams.get("limit")).toBe("200");
    expect(filteredUrl.searchParams.get("from")).toBe("2026-06-19T08:00");
    expect(filteredUrl.searchParams.get("to")).toBe("2026-06-19T12:00");
    expect(filteredUrl.searchParams.get("sourceType")).toBe("charger");
    expect(filteredUrl.searchParams.get("sourceId")).toBe("SMART-EVSE-1");
    expect(filteredUrl.searchParams.get("targetType")).toBe("server");
    expect(filteredUrl.searchParams.get("targetId")).toBe("server");
    expect(filteredUrl.searchParams.get("chargerId")).toBe("SMART-EVSE-1");
    expect(filteredUrl.searchParams.get("proxyTargetId")).toBe("proxy-1");
    expect(filteredUrl.searchParams.get("ocppMethod")).toBe("BootNotification");
    expect(filteredUrl.searchParams.get("messageType")).toBe("call");
  });

  it("expands redacted communication payloads", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";

      if (url === "/api/auth/session") {
        return new Response(JSON.stringify({ authenticated: true, username: "admin" }), { status: 200 });
      }

      if (url === "/api/tags" && method === "GET") {
        return new Response(JSON.stringify([]), { status: 200 });
      }

      if (url === "/api/proxy-targets" && method === "GET") {
        return new Response(
          JSON.stringify([
            {
              id: "proxy-1",
              name: "Tap Electric",
              url: "wss://tap.example/ocpp",
              stationId: "STATION-1",
              enabled: true,
              mode: "deny-capable",
              outagePolicy: "fail-closed",
              hasUsername: true,
              hasBasicAuthPassword: true,
              createdAt: "2026-06-19T08:00:00.000Z",
              updatedAt: "2026-06-19T08:00:00.000Z"
            }
          ]),
          { status: 200 }
        );
      }

      if (url === "/api/dashboard-config" && method === "GET") {
        return emptyVisibilityResponses(url, method)!;
      }

      if (url === "/api/sessions" && method === "GET") {
        return new Response(JSON.stringify([]), { status: 200 });
      }

      if (url === "/api/chargers" && method === "GET") {
        return new Response(JSON.stringify([]), { status: 200 });
      }

      if (url === "/api/logs" && method === "GET") {
        return new Response(JSON.stringify([]), { status: 200 });
      }

      if (url.startsWith("/api/communication-journal") && method === "GET") {
        return new Response(
          JSON.stringify({
            items: [
              {
                id: "journal-1",
                createdAt: "2026-06-19T10:15:00.000Z",
                direction: "outbound",
                sourceType: "server",
                sourceId: "server",
                targetType: "proxy",
                targetId: "proxy-1",
                chargerId: "SMART-EVSE-1",
                proxyTargetId: "proxy-1",
                messageType: "call",
                ocppMethod: "Authorize",
                transactionId: 7,
                idTag: "TAG-1",
                payload: {
                  idTag: "TAG-1",
                  password: "[redacted]",
                  nested: {
                    token: "[redacted]"
                  }
                },
                errorCode: null,
                errorDescription: null,
                correlationId: "corr-1"
              }
            ],
            retentionHours: 24
          }),
          { status: 200 }
        );
      }

      const fallbackResponse = emptyVisibilityResponses(url, method);
      if (fallbackResponse) return fallbackResponse;
      throw new Error(`Unexpected request: ${url}`);
    });

    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    expect(await screen.findByRole("heading", { name: "Home dashboard" })).toBeInTheDocument();

    const sidebar = within(screen.getByRole("complementary", { name: "Main navigation" }));
    fireEvent.click(sidebar.getByRole("button", { name: "Communication" }));

    expect(await screen.findAllByTitle("proxy-1")).not.toHaveLength(0);
    expect(screen.getAllByText(/proxy-1/).length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: "Show payload" }));

    expect(screen.getByText(/"password": "\[redacted\]"/)).toBeInTheDocument();
    expect(screen.getByText(/"token": "\[redacted\]"/)).toBeInTheDocument();
  });

  it("purges the communication journal and refreshes the list", async () => {
    let journalRows: TestCommunicationJournalItem[] = [
      {
        id: "journal-1",
        createdAt: "2026-06-19T10:15:00.000Z",
        direction: "inbound",
        sourceType: "charger",
        sourceId: "SMART-EVSE-1",
        targetType: "server",
        targetId: "server",
        chargerId: "SMART-EVSE-1",
        proxyTargetId: null,
        messageType: "call",
        ocppMethod: "BootNotification",
        transactionId: null,
        idTag: null,
        payload: { chargePointVendor: "Smart EVSE" },
        errorCode: null,
        errorDescription: null,
        correlationId: null
      }
    ];

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";

      if (url === "/api/auth/session") {
        return new Response(JSON.stringify({ authenticated: true, username: "admin" }), { status: 200 });
      }

      if (url === "/api/tags" && method === "GET") {
        return new Response(JSON.stringify([]), { status: 200 });
      }

      if (url === "/api/proxy-targets" && method === "GET") {
        return new Response(JSON.stringify([]), { status: 200 });
      }

      if (url === "/api/dashboard-config" && method === "GET") {
        return emptyVisibilityResponses(url, method)!;
      }

      if (url === "/api/sessions" && method === "GET") {
        return new Response(JSON.stringify([]), { status: 200 });
      }

      if (url === "/api/chargers" && method === "GET") {
        return new Response(JSON.stringify([]), { status: 200 });
      }

      if (url === "/api/logs" && method === "GET") {
        return new Response(JSON.stringify([]), { status: 200 });
      }

      if (url.startsWith("/api/communication-journal") && method === "GET") {
        return new Response(JSON.stringify({ items: journalRows, retentionHours: 24 }), { status: 200 });
      }

      if (url === "/api/communication-journal/purge" && method === "POST") {
        journalRows = [];
        return new Response(JSON.stringify({ deletedCount: 1, retentionHours: 24 }), { status: 200 });
      }

      const fallbackResponse = emptyVisibilityResponses(url, method);
      if (fallbackResponse) return fallbackResponse;
      throw new Error(`Unexpected request: ${url}`);
    });

    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    expect(await screen.findByRole("heading", { name: "Home dashboard" })).toBeInTheDocument();

    const sidebar = within(screen.getByRole("complementary", { name: "Main navigation" }));
    fireEvent.click(sidebar.getByRole("button", { name: "Communication" }));
    expect(await screen.findByText("BootNotification")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Purge" }));

    expect(await screen.findByText("Purged 1 communication row.")).toBeInTheDocument();
    expect(await screen.findByText("No communication rows match these filters.")).toBeInTheDocument();

    const purgeCall = fetchMock.mock.calls.find(([input, init]) => String(input) === "/api/communication-journal/purge" && init?.method === "POST");
    expect(purgeCall).toBeDefined();
  });

  it("shows edit state for tags and submits tag updates", async () => {
    let tags: TestTag[] = [
      {
        id: "tag-1",
        uuid: "04A1B2C3",
        label: "Main RFID",
        enabled: true,
        createdAt: "2026-06-19T08:00:00.000Z"
      }
    ];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";

      if (url === "/api/auth/session") {
        return new Response(JSON.stringify({ authenticated: true, username: "admin" }), { status: 200 });
      }

      if (url === "/api/tags" && method === "GET") {
        return new Response(JSON.stringify(tags), { status: 200 });
      }

      if (url === "/api/proxy-targets" && method === "GET") {
        return new Response(JSON.stringify([]), { status: 200 });
      }

      const visibilityResponse = emptyVisibilityResponses(url, method);
      if (visibilityResponse) return visibilityResponse;

      if (url === "/api/tags/tag-1" && method === "PATCH") {
        if (!init?.body) throw new Error("Missing tag update body");
        const body = JSON.parse(String(init.body)) as { uuid?: string; label?: string | null; enabled?: boolean };
        tags = tags.map((tag) => ({
          ...tag,
          uuid: body.uuid ?? tag.uuid,
          label: body.label === undefined ? tag.label : body.label,
          enabled: body.enabled ?? tag.enabled
        }));
        return new Response(JSON.stringify(tags[0]), { status: 200 });
      }

      const fallbackResponse = emptyVisibilityResponses(url, method);
      if (fallbackResponse) return fallbackResponse;
      throw new Error(`Unexpected request: ${url}`);
    });

    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    expect(await screen.findByRole("heading", { name: "Home dashboard" })).toBeInTheDocument();

    const sidebar = within(screen.getByRole("complementary", { name: "Main navigation" }));

    fireEvent.click(sidebar.getByRole("button", { name: "Tags" }));
    expect(await screen.findByRole("heading", { name: "Tags" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(screen.getByRole("heading", { name: "Edit tag" })).toBeInTheDocument();
    expect(screen.getByLabelText("Tag UUID")).toHaveValue("04A1B2C3");
    expect(screen.getByLabelText("Label")).toHaveValue("Main RFID");
    expect(screen.getByLabelText("Enabled for charging")).toBeChecked();

    fireEvent.change(screen.getByLabelText("Tag UUID"), { target: { value: "04A1B2C4" } });
    fireEvent.change(screen.getByLabelText("Label"), { target: { value: "Dock RFID" } });
    fireEvent.click(screen.getByLabelText("Enabled for charging"));
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await screen.findByText("Tag updated.");

    const patchCall = fetchMock.mock.calls.find(([input, init]) => String(input) === "/api/tags/tag-1" && init?.method === "PATCH");
    expect(patchCall).toBeDefined();
    expect(JSON.parse(String(patchCall?.[1]?.body))).toEqual({
      uuid: "04A1B2C4",
      label: "Dock RFID",
      enabled: false
    });
  });

  it("shows edit state for proxy targets and can clear stored credentials", async () => {
    let proxyTargets: TestProxyTarget[] = [
      {
        id: "proxy-1",
        name: "Tap Electric",
        url: "wss://tap.example/ocpp",
        stationId: "STATION-1",
        enabled: true,
        mode: "deny-capable" as const,
        outagePolicy: "fail-closed" as const,
        hasUsername: true,
        hasBasicAuthPassword: true,
        tagMappings: [{ id: "mapping-1", localIdTag: "LOCAL-TAG", outboundIdTag: "REMOTE-TAG" }],
        createdAt: "2026-06-19T08:00:00.000Z",
        updatedAt: "2026-06-19T08:00:00.000Z"
      }
    ];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      const parsedUrl = new URL(url, "http://localhost");
      const path = parsedUrl.pathname;

      if (path === "/api/auth/session") {
        return new Response(JSON.stringify({ authenticated: true, username: "admin" }), { status: 200 });
      }

      if (path === "/api/chargers" && method === "GET") {
        return new Response(
          JSON.stringify([
            {
              id: "SMART-EVSE-1",
              label: "Bay 1",
              active: true,
              connectedAt: "2026-06-19T09:00:00.000Z",
              disconnectedAt: null,
              lastSeenAt: "2026-06-19T10:00:00.000Z"
            }
          ]),
          { status: 200 }
        );
      }

      if (path === "/api/tags" && method === "GET") {
        return new Response(JSON.stringify([]), { status: 200 });
      }

      if (path === "/api/proxy-targets" && method === "GET") {
        return new Response(JSON.stringify(proxyTargets), { status: 200 });
      }

      if (path === "/api/sessions" && method === "GET") {
        return new Response(JSON.stringify([]), { status: 200 });
      }

      if (path === "/api/logs" && method === "GET") {
        return new Response(JSON.stringify([]), { status: 200 });
      }

      if (path === "/api/communication-journal" && method === "GET") {
        return new Response(JSON.stringify({ items: [], retentionHours: 24 }), { status: 200 });
      }

      const visibilityResponse = emptyVisibilityResponses(url, method);
      if (visibilityResponse) return visibilityResponse;

      if (path === "/api/proxy-targets/proxy-1" && method === "PATCH") {
        if (!init?.body) throw new Error("Missing proxy target update body");
        const body = JSON.parse(String(init.body)) as {
          name?: string;
          url?: string;
          username?: string | null;
          stationId?: string | null;
          enabled?: boolean;
          mode?: "monitor-only" | "deny-capable";
          outagePolicy?: "fail-open" | "fail-closed";
          basicAuthPassword?: string | null;
          tagMappings?: Array<{ localIdTag: string; outboundIdTag: string }>;
        };
        proxyTargets = proxyTargets.map((target) => ({
          ...target,
          name: body.name ?? target.name,
          url: body.url ?? target.url,
          stationId: body.stationId === undefined ? target.stationId : body.stationId,
          enabled: body.enabled ?? target.enabled,
          mode: body.mode ?? target.mode,
          outagePolicy: body.outagePolicy ?? target.outagePolicy,
          hasUsername: body.username === undefined ? target.hasUsername : Boolean(body.username),
          hasBasicAuthPassword: body.basicAuthPassword === undefined ? target.hasBasicAuthPassword : Boolean(body.basicAuthPassword),
          tagMappings: body.tagMappings === undefined ? target.tagMappings : body.tagMappings
        }));
        return new Response(JSON.stringify(proxyTargets[0]), { status: 200 });
      }

      const fallbackResponse = emptyVisibilityResponses(url, method);
      if (fallbackResponse) return fallbackResponse;
      throw new Error(`Unexpected request: ${url}`);
    });

    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    expect(await screen.findByRole("heading", { name: "Home dashboard" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Charger context"), { target: { value: "SMART-EVSE-1" } });
    const sidebar = within(screen.getByRole("complementary", { name: "Main navigation" }));
    fireEvent.click(sidebar.getByRole("button", { name: "Proxy targets" }));
    expect(await screen.findByText("Tap Electric")).toBeInTheDocument();
    expect(screen.getByText("1 mapping")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));

    const proxyTargetEditor = within(screen.getByRole("heading", { name: "Edit target" }).closest("section") as HTMLElement);
    expect(screen.getByRole("heading", { name: "Edit target" })).toBeInTheDocument();
    expect(proxyTargetEditor.getByLabelText("Name")).toHaveValue("Tap Electric");
    expect(proxyTargetEditor.getByLabelText("URL")).toHaveValue("wss://tap.example/ocpp");
    expect(proxyTargetEditor.getByLabelText("Station ID")).toHaveValue("STATION-1");
    expect(proxyTargetEditor.getByLabelText("Username")).toHaveValue("");
    expect(proxyTargetEditor.getByLabelText("Password")).toHaveValue("");
    expect(proxyTargetEditor.getByLabelText("Clear stored username")).not.toBeChecked();
    expect(proxyTargetEditor.getByLabelText("Clear stored password")).not.toBeChecked();
    expect(proxyTargetEditor.getByDisplayValue("LOCAL-TAG")).toBeInTheDocument();
    expect(proxyTargetEditor.getByDisplayValue("REMOTE-TAG")).toBeInTheDocument();

    fireEvent.click(proxyTargetEditor.getByLabelText("Clear stored username"));
    fireEvent.click(proxyTargetEditor.getByLabelText("Clear stored password"));
    fireEvent.click(proxyTargetEditor.getByRole("button", { name: "Save changes" }));

    await screen.findByText("Proxy target updated.");

    const patchCall = fetchMock.mock.calls.find(([input, init]) => String(input) === "/api/proxy-targets/proxy-1" && init?.method === "PATCH");
    expect(patchCall).toBeDefined();
    expect(JSON.parse(String(patchCall?.[1]?.body))).toEqual({
      name: "Tap Electric",
      url: "wss://tap.example/ocpp",
      stationId: "STATION-1",
      enabled: true,
      mode: "deny-capable",
      outagePolicy: "fail-closed",
      username: null,
      basicAuthPassword: null
    });

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    const mappingEditor = within(screen.getByRole("heading", { name: "Edit target" }).closest("section") as HTMLElement);
    fireEvent.change(mappingEditor.getByDisplayValue("REMOTE-TAG"), { target: { value: "REMOTE-TAG-2" } });
    fireEvent.click(mappingEditor.getByRole("button", { name: "Save changes" }));
    await screen.findByText("Proxy target updated.");

    const mappingPatchCall = fetchMock.mock.calls
      .filter(([input, init]) => String(input) === "/api/proxy-targets/proxy-1" && init?.method === "PATCH")
      .at(-1);
    expect(mappingPatchCall).toBeDefined();
    expect(JSON.parse(String(mappingPatchCall?.[1]?.body))).toMatchObject({
      tagMappings: [
        {
          localIdTag: "LOCAL-TAG",
          outboundIdTag: "REMOTE-TAG-2"
        }
      ]
    });
  });

  it("shows proxy targets for the selected charger context and submits scoped creation", async () => {
    const selectedChargerId = "SMART-EVSE-1";
    let proxyTargets: TestProxyTarget[] = [];
    const chargers: TestChargerRegistryRow[] = [
      {
        id: "charger-row-1",
        chargerId: selectedChargerId,
        label: "Bay 1",
        active: true,
        connectedAt: "2026-06-19T09:00:00.000Z",
        disconnectedAt: null,
        lastSeenAt: "2026-06-19T10:00:00.000Z"
      },
      {
        id: "charger-row-2",
        chargerId: "SMART-EVSE-2",
        label: "Bay 2",
        active: false,
        connectedAt: "2026-06-19T08:00:00.000Z",
        disconnectedAt: "2026-06-19T08:30:00.000Z",
        lastSeenAt: "2026-06-19T08:45:00.000Z"
      }
    ];

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      const parsedUrl = new URL(url, "http://localhost");
      const path = parsedUrl.pathname;
      const chargerId = parsedUrl.searchParams.get("chargerId");

      if (path === "/api/auth/session") {
        return new Response(JSON.stringify({ authenticated: true, username: "admin" }), { status: 200 });
      }

      if (path === "/api/chargers" && method === "GET") {
        return new Response(JSON.stringify(chargers), { status: 200 });
      }

      if (path === "/api/tags" && method === "GET") {
        return new Response(JSON.stringify([]), { status: 200 });
      }

      if (path === "/api/proxy-targets" && method === "GET") {
        return new Response(JSON.stringify(chargerId === selectedChargerId ? proxyTargets : []), { status: 200 });
      }

      if (path === "/api/sessions" && method === "GET") {
        return new Response(JSON.stringify([]), { status: 200 });
      }

      if (path === "/api/logs" && method === "GET") {
        return new Response(JSON.stringify([]), { status: 200 });
      }

      if (path === "/api/communication-journal" && method === "GET") {
        return new Response(JSON.stringify({ items: [], retentionHours: 24 }), { status: 200 });
      }

      const visibilityResponse = emptyVisibilityResponses(url, method);
      if (visibilityResponse) return visibilityResponse;

      if (path === "/api/proxy-targets" && method === "POST") {
        if (!init?.body) throw new Error("Missing proxy target create body");
        const body = JSON.parse(String(init.body)) as {
          name?: string;
          url?: string;
          chargerId?: string;
          enabled?: boolean;
          mode?: "monitor-only" | "deny-capable";
          outagePolicy?: "fail-open" | "fail-closed";
          stationId?: string | null;
          tagMappings?: Array<{ localIdTag: string; outboundIdTag: string }>;
        };
        proxyTargets = [
          {
            id: "proxy-1",
            name: body.name ?? "",
            url: body.url ?? "",
            stationId: body.stationId ?? null,
            enabled: body.enabled ?? true,
            mode: body.mode ?? "monitor-only",
            outagePolicy: body.outagePolicy ?? "fail-open",
            hasUsername: false,
            hasBasicAuthPassword: false,
            tagMappings: body.tagMappings,
            createdAt: "2026-06-19T10:30:00.000Z",
            updatedAt: "2026-06-19T10:30:00.000Z"
          }
        ];
        return new Response(JSON.stringify(proxyTargets[0]), { status: 200 });
      }

      const fallbackResponse = emptyVisibilityResponses(url, method);
      if (fallbackResponse) return fallbackResponse;
      throw new Error(`Unexpected request: ${url}`);
    });

    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    expect(await screen.findByRole("heading", { name: "Home dashboard" })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Charger context"), { target: { value: selectedChargerId } });

    const sidebar = within(screen.getByRole("complementary", { name: "Main navigation" }));
    fireEvent.click(sidebar.getByRole("button", { name: "Proxy targets" }));

    expect(await screen.findByRole("heading", { name: "Proxy targets" })).toBeInTheDocument();
    expect(screen.getByText("Targets are listed for the selected charger context.")).toBeInTheDocument();
    expect(screen.getByText("No proxy targets configured yet.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Add target" }));
    const targetEditor = within(screen.getByRole("heading", { name: "Add target" }).closest("section") as HTMLElement);
    fireEvent.change(targetEditor.getByLabelText("Name"), { target: { value: "Tap Electric" } });
    fireEvent.change(targetEditor.getByLabelText("URL"), { target: { value: "wss://tap.example/ocpp" } });
    fireEvent.change(targetEditor.getByLabelText("Station ID"), { target: { value: "STATION-1" } });
    fireEvent.change(targetEditor.getByLabelText("Mode"), { target: { value: "deny-capable" } });
    fireEvent.change(targetEditor.getByLabelText("Outage policy"), { target: { value: "fail-closed" } });
    fireEvent.click(targetEditor.getByRole("button", { name: "Add mapping" }));
    fireEvent.change(targetEditor.getByPlaceholderText("SmartEVSE idTag"), { target: { value: "LOCAL-TAG" } });
    fireEvent.change(targetEditor.getByPlaceholderText("Proxy idTag"), { target: { value: "REMOTE-TAG" } });
    fireEvent.click(targetEditor.getByRole("button", { name: "Add target" }));

    await screen.findByText("Proxy target saved.");
    expect(screen.getByText("Tap Electric")).toBeInTheDocument();

    const postCall = fetchMock.mock.calls.find(([input, init]) => String(input) === "/api/proxy-targets" && init?.method === "POST");
    expect(postCall).toBeDefined();
    expect(JSON.parse(String(postCall?.[1]?.body))).toEqual({
      name: "Tap Electric",
      url: "wss://tap.example/ocpp",
      enabled: true,
      mode: "deny-capable",
      outagePolicy: "fail-closed",
      chargerId: selectedChargerId,
      stationId: "STATION-1",
      tagMappings: [
        {
          localIdTag: "LOCAL-TAG",
          outboundIdTag: "REMOTE-TAG"
        }
      ]
    });
  });

  it("shows sessions and communication pages after authentication", async () => {
    let sessionClosed = false;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";

      if (url === "/api/auth/session") {
        return new Response(JSON.stringify({ authenticated: true, username: "admin" }), { status: 200 });
      }

      if (url === "/api/tags" && method === "GET") {
        return new Response(JSON.stringify([]), { status: 200 });
      }

      if (url === "/api/proxy-targets" && method === "GET") {
        return new Response(JSON.stringify([]), { status: 200 });
      }

      if (url === "/api/dashboard-config" && method === "GET") {
        return emptyVisibilityResponses(url, method)!;
      }

      if (url === "/api/sessions" && method === "GET") {
        return new Response(
          JSON.stringify([
            {
              id: "session-1",
              chargerId: "SMART-EVSE-1",
              connectorId: 1,
              transactionId: 42,
              idTag: "TAG-1",
              startedAt: "2026-06-19T09:05:00.000Z",
              stoppedAt: sessionClosed ? "2026-06-19T09:30:00.000Z" : null,
              startMeterWh: 1000,
              stopMeterWh: sessionClosed ? 1550 : null,
              stopReason: sessionClosed ? "OperatorForceClosed" : null,
              status: sessionClosed ? "stopped" : "active",
              active: !sessionClosed
            }
          ]),
          { status: 200 }
        );
      }

      if (url === "/api/active-session-audit" && method === "GET") {
        return new Response(
          JSON.stringify({
            summary: { activeSessions: sessionClosed ? 0 : 1, flaggedSessions: sessionClosed ? 0 : 1 },
            items: sessionClosed
              ? []
              : [
                  {
                    sessionId: "session-1",
                    chargerId: "SMART-EVSE-1",
                    connectorId: 1,
                    transactionId: 42,
                    startedAt: "2026-06-19T09:05:00.000Z",
                    chargerConnected: true,
                    latestStatus: "Available",
                    latestStatusAt: "2026-06-19T09:26:00.000Z",
                    latestMeterSampleAt: "2026-06-19T09:25:00.000Z",
                    latestMeterWh: 1550,
                    forceCloseMeterSource: "latest-meter-sample",
                    proxyMappings: [
                      {
                        proxyTargetId: "proxy-1",
                        proxyTargetName: "TapElectric",
                        externalTransactionId: 4242,
                        stoppedAt: null
                      }
                    ],
                    warnings: [
                      {
                        code: "connector_available_without_stop_transaction",
                        severity: "warn",
                        message: "Connector is Available but the session is still active; the charger may have missed StopTransaction.",
                        createdAt: "2026-06-19T09:26:00.000Z"
                      }
                    ],
                    recommendedAction: "force_close_preview"
                  }
                ]
          }),
          { status: 200 }
        );
      }

      if (url === "/api/sessions/session-1/force-close-preview" && method === "GET") {
        return new Response(
          JSON.stringify({
            session: {
              id: "session-1",
              chargerId: "SMART-EVSE-1",
              connectorId: 1,
              transactionId: 42,
              idTag: "TAG-1",
              startedAt: "2026-06-19T09:05:00.000Z",
              stoppedAt: null,
              startMeterWh: 1000,
              stopMeterWh: null,
              stopReason: null,
              status: "active",
              active: true
            },
            localStopTransaction: {
              transactionId: 42,
              idTag: "TAG-1",
              meterStop: 1550,
              timestamp: "2026-06-19T09:25:00.000Z",
              reason: "Local"
            },
            meterSource: "latest-meter-sample",
            latestMeterSample: {
              sampledAt: "2026-06-19T09:25:00.000Z",
              value: "1550",
              meterWh: 1550,
              measurand: "Energy.Active.Import.Register",
              unit: "Wh",
              transactionId: null
            },
            proxyPayloads: [
              {
                proxyTargetId: "proxy-1",
                proxyTargetName: "TapElectric",
                proxyTargetEnabled: true,
                externalTransactionId: 4242,
                payload: {
                  transactionId: 4242,
                  idTag: "TAG-1",
                  meterStop: 1550,
                  timestamp: "2026-06-19T09:25:00.000Z",
                  reason: "Local"
                }
              }
            ],
            warnings: []
          }),
          { status: 200 }
        );
      }

      if (url === "/api/sessions/session-1/force-close" && method === "POST") {
        sessionClosed = true;
        return new Response(
          JSON.stringify({
            session: {
              id: "session-1",
              chargerId: "SMART-EVSE-1",
              connectorId: 1,
              transactionId: 42,
              idTag: "TAG-1",
              startedAt: "2026-06-19T09:05:00.000Z",
              stoppedAt: "2026-06-19T09:30:00.000Z",
              startMeterWh: 1000,
              stopMeterWh: 1550,
              stopReason: "OperatorForceClosed",
              status: "stopped",
              active: false
            },
            localStopTransaction: {
              transactionId: 42,
              idTag: "TAG-1",
              meterStop: 1550,
              timestamp: "2026-06-19T09:25:00.000Z",
              reason: "Local"
            },
            meterSource: "latest-meter-sample",
            latestMeterSample: null,
            proxyPayloads: [],
            warnings: [],
            proxyResults: [
              {
                proxyTargetId: "proxy-1",
                proxyTargetName: "TapElectric",
                externalTransactionId: 4242,
                attempted: true,
                ok: true
              }
            ]
          }),
          { status: 200 }
        );
      }

      if (url === "/api/sessions/session-1/remote-stop" && method === "POST") {
        return new Response(JSON.stringify({ ok: true, status: "Accepted" }), { status: 200 });
      }

      if (url === "/api/chargers" && method === "GET") {
        return new Response(
          JSON.stringify([
            {
              id: "SMART-EVSE-1",
              label: null,
              lastSeenAt: "2026-06-19T09:00:00.000Z",
              connectedAt: "2026-06-19T09:00:00.000Z",
              disconnectedAt: null,
              active: true
            }
          ]),
          { status: 200 }
        );
      }

      if (url === "/api/charger-connections" && method === "GET") {
        return new Response(
          JSON.stringify([
            {
              id: "connection-1",
              chargerId: "SMART-EVSE-1",
              connectedAt: "2026-06-19T09:00:00.000Z",
              disconnectedAt: null,
              active: true
            }
          ]),
          { status: 200 }
        );
      }

      if (url === "/api/logs" && method === "GET") {
        return new Response(
          JSON.stringify([
            {
              id: "log-1",
              level: "info",
              category: "session",
              message: "charging session started",
              chargerId: "SMART-EVSE-1",
              transactionId: 42,
              createdAt: "2026-06-19T09:06:00.000Z",
              hasMetadata: true,
              context: {
                proxyTargetId: "proxy-1",
                method: "StartTransaction",
                status: "Accepted"
              }
            }
          ]),
          { status: 200 }
        );
      }

      if (url.startsWith("/api/communication-journal") && method === "GET") {
        return new Response(JSON.stringify({ items: [], retentionHours: 24 }), { status: 200 });
      }

      const fallbackResponse = emptyVisibilityResponses(url, method);
      if (fallbackResponse) return fallbackResponse;
      throw new Error(`Unexpected request: ${url}`);
    });

    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    expect(await screen.findByRole("heading", { name: "Home dashboard" })).toBeInTheDocument();

    const sidebar = within(screen.getByRole("complementary", { name: "Main navigation" }));
    fireEvent.click(sidebar.getByRole("button", { name: "Sessions" }));
    expect(screen.getByRole("heading", { name: "Sessions" })).toBeInTheDocument();
    expect((await screen.findAllByText("SMART-EVSE-1")).length).toBeGreaterThan(0);
    expect(await screen.findByText("TAG-1")).toBeInTheDocument();
    expect(screen.getByText("Missing stop?")).toBeInTheDocument();
    expect(screen.getByText(/charger may have missed StopTransaction/)).toBeInTheDocument();
    expect(screen.getByText("Latest meter: 1.55 kWh")).toBeInTheDocument();
    expect(screen.getByText("Status: Available")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Remote stop session 42" }));
    await screen.findByText("Remote stop accepted for session 42.");
    expect(fetchMock.mock.calls.some(([input, init]) => String(input) === "/api/sessions/session-1/remote-stop" && init?.method === "POST")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Force close session 42" }));
    expect(await screen.findByRole("heading", { name: "Review StopTransaction" })).toBeInTheDocument();
    expect(screen.getByText("TapElectric")).toBeInTheDocument();
    expect(screen.getAllByText(/1550/).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "Force close" }));
    await screen.findByText("Force closed session 42.");
    expect(fetchMock.mock.calls.some(([input, init]) => String(input) === "/api/sessions/session-1/force-close-preview" && (init?.method ?? "GET") === "GET")).toBe(true);
    expect(fetchMock.mock.calls.some(([input, init]) => String(input) === "/api/sessions/session-1/force-close" && init?.method === "POST")).toBe(true);
    expect(await screen.findByText("OperatorForceClosed")).toBeInTheDocument();

    fireEvent.click(sidebar.getByRole("button", { name: "Communication" }));
    expect(screen.getByRole("heading", { name: "Communication" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Activity" })).not.toBeInTheDocument();
  });

  it("scopes charger-facing views to the selected charger context", async () => {
    const selectedChargerId = "SMART-EVSE-1";
    const chargers: TestChargerRegistryRow[] = [
      {
        id: "charger-1",
        chargerId: selectedChargerId,
        label: "Bay 1",
        active: true,
        connectedAt: "2026-06-19T09:00:00.000Z",
        disconnectedAt: null,
        lastSeenAt: "2026-06-19T10:00:00.000Z"
      },
      {
        id: "charger-2",
        chargerId: "SMART-EVSE-2",
        label: "Bay 2",
        active: false,
        connectedAt: "2026-06-19T08:00:00.000Z",
        disconnectedAt: "2026-06-19T08:30:00.000Z",
        lastSeenAt: "2026-06-19T08:45:00.000Z"
      }
    ];

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      const parsedUrl = new URL(url, "http://localhost");
      const path = parsedUrl.pathname;
      const chargerId = parsedUrl.searchParams.get("chargerId");

      if (path === "/api/auth/session") {
        return new Response(JSON.stringify({ authenticated: true, username: "admin" }), { status: 200 });
      }

      if (path === "/api/chargers" && method === "GET") {
        return new Response(JSON.stringify(chargers), { status: 200 });
      }

      if (path === "/api/dashboard-config" && method === "GET") {
        return emptyVisibilityResponses(url, method)!;
      }

      if (path === "/api/tags" && method === "GET") {
        return new Response(
          JSON.stringify([
            {
              id: "tag-1",
              uuid: "04A1B2C3",
              label: "Main RFID",
              enabled: true,
              createdAt: "2026-06-19T08:00:00.000Z",
              chargerAccess: [{ chargerId: selectedChargerId, enabled: true }]
            }
          ]),
          { status: 200 }
        );
      }

      if (path === "/api/proxy-targets" && method === "GET") {
        return new Response(
          JSON.stringify(
            chargerId === selectedChargerId
              ? [
                  {
                    id: "proxy-1",
                    name: "Tap Electric",
                    url: "wss://tap.example/ocpp",
                    stationId: "STATION-1",
                    enabled: true,
                    mode: "deny-capable",
                    outagePolicy: "fail-closed",
                    hasUsername: true,
                    hasBasicAuthPassword: true,
                    createdAt: "2026-06-19T08:00:00.000Z",
                    updatedAt: "2026-06-19T08:00:00.000Z"
                  }
                ]
              : []
          ),
          { status: 200 }
        );
      }

      if (path === "/api/sessions" && method === "GET") {
        return new Response(
          JSON.stringify(
            chargerId === selectedChargerId
              ? [
                  {
                    id: "session-1",
                    chargerId: selectedChargerId,
                    connectorId: 1,
                    transactionId: 42,
                    idTag: "TAG-1",
                    startedAt: "2026-06-19T09:05:00.000Z",
                    stoppedAt: null,
                    startMeterWh: 1000,
                    stopMeterWh: null,
                    stopReason: null,
                    status: "active",
                    active: true
                  }
                ]
              : []
          ),
          { status: 200 }
        );
      }

      if (path === "/api/charger-connections" && method === "GET") {
        return new Response(
          JSON.stringify(
            chargerId === selectedChargerId
              ? [
                  {
                    id: "connection-1",
                    chargerId: selectedChargerId,
                    connectedAt: "2026-06-19T09:00:00.000Z",
                    disconnectedAt: null,
                    active: true
                  }
                ]
              : []
          ),
          { status: 200 }
        );
      }

      if (path === "/api/logs" && method === "GET") {
        return new Response(
          JSON.stringify(
            chargerId === selectedChargerId
              ? [
                  {
                    id: "log-1",
                    level: "info",
                    category: "session",
                    message: "charging session started",
                    chargerId: selectedChargerId,
                    transactionId: 42,
                    createdAt: "2026-06-19T09:06:00.000Z",
                    hasMetadata: true,
                    context: {
                      proxyTargetId: "proxy-1",
                      method: "StartTransaction",
                      status: "Accepted"
                    }
                  }
                ]
              : []
          ),
          { status: 200 }
        );
      }

      if (path === "/api/communication-journal" && method === "GET") {
        return new Response(
          JSON.stringify(
            chargerId === selectedChargerId
              ? {
                  items: [
                    {
                      id: "journal-1",
                      createdAt: "2026-06-19T10:15:00.000Z",
                      direction: "outbound",
                      sourceType: "server",
                      sourceId: "server",
                      targetType: "proxy",
                      targetId: "proxy-1",
                      chargerId: selectedChargerId,
                      proxyTargetId: "proxy-1",
                      messageType: "call",
                      ocppMethod: "Authorize",
                      transactionId: 7,
                      idTag: "TAG-1",
                      payload: { idTag: "TAG-1" },
                      errorCode: null,
                      errorDescription: null,
                      correlationId: "corr-1"
                    }
                  ],
                  retentionHours: 24
                }
              : { items: [], retentionHours: 24 }
          ),
          { status: 200 }
        );
      }

      const fallbackResponse = emptyVisibilityResponses(url, method);
      if (fallbackResponse) return fallbackResponse;
      throw new Error(`Unexpected request: ${url}`);
    });

    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    expect(await screen.findByRole("heading", { name: "Home dashboard" })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Charger context"), { target: { value: selectedChargerId } });

    const sidebar = within(screen.getByRole("complementary", { name: "Main navigation" }));

    fireEvent.click(sidebar.getByRole("button", { name: "Proxy targets" }));
    expect(await screen.findByRole("heading", { name: "Proxy targets" })).toBeInTheDocument();
    expect(screen.getAllByText("Tap Electric").length).toBeGreaterThan(0);

    fireEvent.click(sidebar.getByRole("button", { name: "Sessions" }));
    expect(await screen.findByRole("heading", { name: "Sessions" })).toBeInTheDocument();
    expect(screen.getByText("TAG-1")).toBeInTheDocument();
    expect(screen.getByText("SMART-EVSE-1")).toBeInTheDocument();

    fireEvent.click(sidebar.getByRole("button", { name: "Communication" }));
    expect(await screen.findByRole("heading", { name: "Communication" })).toBeInTheDocument();
    expect(screen.getByLabelText("Charger id")).toBeDisabled();
    expect(screen.getByDisplayValue(selectedChargerId)).toBeInTheDocument();

    fireEvent.click(sidebar.getByRole("button", { name: "Tags" }));
    expect(await screen.findByRole("heading", { name: "Tags" })).toBeInTheDocument();
    expect(screen.getByText("Allowed")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Revoke access" })).toBeInTheDocument();
  });

  it("grants and revokes selected charger access for tags", async () => {
    const selectedChargerId = "SMART-EVSE-1";
    let tag: TestTag = {
      id: "tag-1",
      uuid: "04A1B2C3",
      label: "Main RFID",
      enabled: true,
      createdAt: "2026-06-19T08:00:00.000Z",
      chargerAccess: []
    };

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      const parsedUrl = new URL(url, "http://localhost");
      const path = parsedUrl.pathname;
      const chargerId = parsedUrl.searchParams.get("chargerId");

      if (path === "/api/auth/session") {
        return new Response(JSON.stringify({ authenticated: true, username: "admin" }), { status: 200 });
      }

      if (path === "/api/chargers" && method === "GET") {
        return new Response(
          JSON.stringify([
            {
              id: "charger-1",
              chargerId: selectedChargerId,
              label: "Bay 1",
              active: true,
              connectedAt: "2026-06-19T09:00:00.000Z",
              disconnectedAt: null,
              lastSeenAt: "2026-06-19T10:00:00.000Z"
            }
          ]),
          { status: 200 }
        );
      }

      if (path === "/api/dashboard-config" && method === "GET") {
        return emptyVisibilityResponses(url, method)!;
      }

      if (path === "/api/tags" && method === "GET") {
        return new Response(JSON.stringify(chargerId === selectedChargerId ? [tag] : []), { status: 200 });
      }

      if (path === "/api/proxy-targets" && method === "GET") {
        return new Response(JSON.stringify([]), { status: 200 });
      }

      if (path === "/api/sessions" && method === "GET") {
        return new Response(JSON.stringify([]), { status: 200 });
      }

      if (path === "/api/logs" && method === "GET") {
        return new Response(JSON.stringify([]), { status: 200 });
      }

      if (path === "/api/communication-journal" && method === "GET") {
        return new Response(JSON.stringify({ items: [], retentionHours: 24 }), { status: 200 });
      }

      if (path === `/api/tags/tag-1/chargers/${selectedChargerId}` && method === "PUT") {
        if (!init?.body) throw new Error("Missing tag access body");
        tag = { ...tag, chargerAccess: [{ chargerId: selectedChargerId, enabled: true }] };
        return new Response(JSON.stringify(tag), { status: 200 });
      }

      if (path === `/api/tags/tag-1/chargers/${selectedChargerId}` && method === "DELETE") {
        tag = { ...tag, chargerAccess: [] };
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }

      const fallbackResponse = emptyVisibilityResponses(url, method);
      if (fallbackResponse) return fallbackResponse;
      throw new Error(`Unexpected request: ${url}`);
    });

    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    expect(await screen.findByRole("heading", { name: "Home dashboard" })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Charger context"), { target: { value: selectedChargerId } });
    const sidebar = within(screen.getByRole("complementary", { name: "Main navigation" }));
    fireEvent.click(sidebar.getByRole("button", { name: "Tags" }));

    expect(await screen.findByRole("heading", { name: "Tags" })).toBeInTheDocument();
    expect(await screen.findByText("Blocked")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Grant access" }));

    await screen.findByText("Tag access granted for the selected charger.");
    expect(await screen.findByText("Allowed")).toBeInTheDocument();

    const grantCall = fetchMock.mock.calls.find(([input, init]) => {
      const url = new URL(String(input), "http://localhost");
      return url.pathname === `/api/tags/tag-1/chargers/${selectedChargerId}` && init?.method === "PUT";
    });
    expect(grantCall).toBeDefined();
    expect(JSON.parse(String(grantCall?.[1]?.body))).toEqual({
      enabled: true
    });

    fireEvent.click(screen.getByRole("button", { name: "Revoke access" }));

    await screen.findByText("Tag access revoked for the selected charger.");
    expect(await screen.findByText("Blocked")).toBeInTheDocument();

    const revokeCall = fetchMock.mock.calls.find(([input, init]) => {
      const url = new URL(String(input), "http://localhost");
      return url.pathname === `/api/tags/tag-1/chargers/${selectedChargerId}` && init?.method === "DELETE";
    });
    expect(revokeCall).toBeDefined();
  });

  it("returns to login when a protected refresh gets unauthorized", async () => {
    let expireSession = false;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";

      if (url === "/api/auth/session") {
        return new Response(JSON.stringify({ authenticated: true, username: "admin" }), { status: 200 });
      }

      if (url.startsWith("/api/communication-journal") && method === "GET" && expireSession) {
        return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 });
      }

      if (url === "/api/tags" && method === "GET") {
        return new Response(JSON.stringify([]), { status: 200 });
      }

      if (url === "/api/proxy-targets" && method === "GET") {
        return new Response(JSON.stringify([]), { status: 200 });
      }

      const visibilityResponse = emptyVisibilityResponses(url, method);
      if (visibilityResponse) return visibilityResponse;

      if (url === "/api/sessions" && method === "GET") {
        return new Response(JSON.stringify([]), { status: 200 });
      }

      if (url === "/api/chargers" && method === "GET") {
        return new Response(JSON.stringify([]), { status: 200 });
      }

      if (url === "/api/logs" && method === "GET") {
        return new Response(JSON.stringify([]), { status: 200 });
      }

      if (url.startsWith("/api/communication-journal") && method === "GET") {
        return new Response(JSON.stringify({ items: [], retentionHours: 24 }), { status: 200 });
      }

      const fallbackResponse = emptyVisibilityResponses(url, method);
      if (fallbackResponse) return fallbackResponse;
      throw new Error(`Unexpected request: ${url}`);
    });

    vi.stubGlobal("fetch", fetchMock);

    render(<App />);
    expect(await screen.findByRole("heading", { name: "Home dashboard" })).toBeInTheDocument();

    const sidebar = within(screen.getByRole("complementary", { name: "Main navigation" }));
    fireEvent.click(sidebar.getByRole("button", { name: "Communication" }));
    expireSession = true;
    fireEvent.click(screen.getAllByRole("button", { name: "Refresh" })[0]);

    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeInTheDocument();
    expect(screen.getByText("Session expired. Sign in again.")).toBeInTheDocument();
  });

  it("signs out from the protected interface", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";

      if (url === "/api/auth/session") {
        return new Response(JSON.stringify({ authenticated: true, username: "admin" }), { status: 200 });
      }

      if (url === "/api/auth/logout" && method === "POST") {
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }

      if (url === "/api/tags" && method === "GET") {
        return new Response(JSON.stringify([]), { status: 200 });
      }

      if (url === "/api/proxy-targets" && method === "GET") {
        return new Response(JSON.stringify([]), { status: 200 });
      }

      const visibilityResponse = emptyVisibilityResponses(url, method);
      if (visibilityResponse) return visibilityResponse;

      const fallbackResponse = emptyVisibilityResponses(url, method);
      if (fallbackResponse) return fallbackResponse;
      throw new Error(`Unexpected request: ${url}`);
    });

    vi.stubGlobal("fetch", fetchMock);

    render(<App />);
    expect(await screen.findByRole("heading", { name: "Home dashboard" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));

    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeInTheDocument();
    expect(screen.getByText("Signed out.")).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([input, init]) => String(input) === "/api/auth/logout" && init?.method === "POST")).toBe(true);
  });
});
