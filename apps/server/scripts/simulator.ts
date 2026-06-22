import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { RPCClient } from 'ocpp-rpc';

type SimulatorOptions = {
  url: string;
  chargerId: string;
  tagId: string;
  connectorId: number;
  meterStartWh: number;
  meterStepWh: number;
  meterSamples: number;
  sampleIntervalMs: number;
  runTimeMs: number | null;
  powerKw: number | null;
  heartbeatCount: number;
  heartbeatIntervalMs: number;
  basicAuthPassword?: string;
  ensureTag: boolean;
  adminUrl: string;
  adminUsername: string;
  adminPassword: string;
  keepOpen: boolean;
  smoke: boolean;
  help: boolean;
};

type TagResponse = {
  id: string;
  uuid: string;
  enabled: boolean;
  chargerAccess?: Array<{
    chargerId: string;
    enabled: boolean;
  }>;
};

type OcppClient = InstanceType<typeof RPCClient>;
type SimulatorRuntimeState = {
  stopping: boolean;
  stopRequested: boolean;
  stopWaiters: Set<() => void>;
  transactionId: number | null;
  meterWh: number;
  stopped: boolean;
  connected: boolean;
};

const DEFAULT_CHARGER_ID = 'SIM-001';
const DEFAULT_TAG_ID = 'SIM-TAG-001';

export function parseSimulatorArgs(argv: string[], env: NodeJS.ProcessEnv = process.env): SimulatorOptions {
  const values = new Map<string, string>();
  const flags = new Set<string>();

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--')) {
      throw new Error(`Unexpected positional argument: ${arg}`);
    }

    const [rawKey, inlineValue] = arg.slice(2).split('=', 2);
    if (isBooleanFlag(rawKey)) {
      flags.add(rawKey);
      continue;
    }

    const value = inlineValue ?? argv[index + 1];
    if (!value || value.startsWith('--')) {
      throw new Error(`Missing value for --${rawKey}`);
    }
    values.set(rawKey, value);
    if (inlineValue === undefined) index += 1;
  }

  const url = values.get('url') ?? env.SIMULATOR_OCPP_URL ?? 'ws://localhost:8797/ocpp';
  const adminUrl = values.get('admin-url') ?? env.SIMULATOR_ADMIN_URL ?? inferAdminUrl(url);
  const runTimeRaw = values.get('run-time') ?? env.SIMULATOR_RUN_TIME;
  const hasSampleInterval = values.has('sample-interval-ms') || env.SIMULATOR_SAMPLE_INTERVAL_MS !== undefined;
  const smoke = flags.has('smoke') || env.SIMULATOR_SMOKE === 'true';
  const sampleIntervalDefault = smoke ? '100' : runTimeRaw && !hasSampleInterval ? '60000' : '1000';

  return {
    url,
    chargerId: values.get('charger-id') ?? env.SIMULATOR_CHARGER_ID ?? (smoke ? 'SMOKE-001' : DEFAULT_CHARGER_ID),
    tagId: values.get('tag-id') ?? env.SIMULATOR_TAG_ID ?? (smoke ? 'SMOKE-TAG-001' : DEFAULT_TAG_ID),
    connectorId: parsePositiveInteger(values.get('connector-id') ?? env.SIMULATOR_CONNECTOR_ID ?? '1', 'connector-id'),
    meterStartWh: parseNonNegativeInteger(values.get('meter-start-wh') ?? env.SIMULATOR_METER_START_WH ?? '1000', 'meter-start-wh'),
    meterStepWh: parseNonNegativeInteger(values.get('meter-step-wh') ?? env.SIMULATOR_METER_STEP_WH ?? (smoke ? '250' : '500'), 'meter-step-wh'),
    meterSamples: parseNonNegativeInteger(values.get('meter-samples') ?? env.SIMULATOR_METER_SAMPLES ?? (smoke ? '2' : '3'), 'meter-samples'),
    sampleIntervalMs: parsePositiveInteger(values.get('sample-interval-ms') ?? env.SIMULATOR_SAMPLE_INTERVAL_MS ?? sampleIntervalDefault, 'sample-interval-ms'),
    runTimeMs: runTimeRaw ? parseDurationMs(runTimeRaw, 'run-time') : null,
    powerKw: parseOptionalPositiveNumber(values.get('power-kw') ?? env.SIMULATOR_POWER_KW, 'power-kw'),
    heartbeatCount: parseNonNegativeInteger(values.get('heartbeat-count') ?? env.SIMULATOR_HEARTBEAT_COUNT ?? '1', 'heartbeat-count'),
    heartbeatIntervalMs: parseNonNegativeInteger(values.get('heartbeat-interval-ms') ?? env.SIMULATOR_HEARTBEAT_INTERVAL_MS ?? '60000', 'heartbeat-interval-ms'),
    basicAuthPassword: values.get('basic-auth-password') ?? env.SIMULATOR_BASIC_AUTH_PASSWORD ?? env.OCPP_BASIC_AUTH_PASSWORD,
    ensureTag: smoke || flags.has('ensure-tag') || env.SIMULATOR_ENSURE_TAG === 'true',
    adminUrl,
    adminUsername: values.get('admin-username') ?? env.SIMULATOR_ADMIN_USERNAME ?? env.ADMIN_USERNAME ?? 'admin',
    adminPassword: values.get('admin-password') ?? env.SIMULATOR_ADMIN_PASSWORD ?? env.ADMIN_PASSWORD ?? '',
    keepOpen: flags.has('keep-open') || env.SIMULATOR_KEEP_OPEN === 'true',
    smoke,
    help: flags.has('help')
  };
}

export function inferAdminUrl(ocppUrl: string) {
  const parsed = new URL(ocppUrl);
  parsed.protocol = parsed.protocol === 'wss:' ? 'https:' : 'http:';
  parsed.pathname = '';
  parsed.search = '';
  parsed.hash = '';
  return parsed.toString().replace(/\/$/, '');
}

export function usage() {
  return `OCPP charger simulator

Usage:
  npm run simulator --workspace=@virtual-ocpp/server -- [options]
  npm run simulator -- [options]

Options:
  --url <ws-url>                  OCPP websocket endpoint. Default: ws://localhost:8797/ocpp
  --charger-id <id>               Charger identity. Default: ${DEFAULT_CHARGER_ID}
  --tag-id <id>                   RFID/tag id used for Authorize and StartTransaction. Default: ${DEFAULT_TAG_ID}
  --connector-id <number>         Connector id. Default: 1
  --meter-start-wh <number>       Start meter value. Default: 1000
  --meter-step-wh <number>        Wh added per meter sample. Default: 500
  --meter-samples <number>        Number of MeterValues calls. Default: 3
  --sample-interval-ms <number>   Delay between meter samples. Default: 1000
  --run-time <duration>           Run charging for a duration, for example 15m, 90s, or 1h.
  --power-kw <number>             Charging power in kW for --run-time mode, for example 11.
  --heartbeat-count <number>      Heartbeats before authorization. Default: 1
  --heartbeat-interval-ms <num>   Delay used by --keep-open heartbeats. Default: 60000
  --basic-auth-password <value>   OCPP Basic Auth password when the server requires it.
  --ensure-tag                    Login to admin API, create/enable tag, and grant charger access.
  --smoke                         Fast smoke defaults: SMOKE-001, SMOKE-TAG-001, ensure tag, 2 meter samples.
  --admin-url <http-url>          Admin API base URL. Default: inferred from --url
  --admin-username <value>        Admin username. Default: ADMIN_USERNAME or admin
  --admin-password <value>        Admin password. Default: ADMIN_PASSWORD
  --keep-open                     Keep the websocket open and continue Heartbeat calls.
  --help                          Show this help text.

Environment aliases use SIMULATOR_* names, for example SIMULATOR_CHARGER_ID and SIMULATOR_ENSURE_TAG=true.
`;
}

async function runSimulator(options: SimulatorOptions) {
  if (options.help) {
    console.log(usage());
    return;
  }

  const client = new RPCClient({
    endpoint: options.url,
    identity: options.chargerId,
    password: options.basicAuthPassword,
    protocols: ['ocpp1.6'],
    strictMode: true
  } as ConstructorParameters<typeof RPCClient>[0]) as OcppClient;

  console.log(`Connecting ${options.chargerId} to ${options.url}`);
  await client.connect();
  const state: SimulatorRuntimeState = {
    stopping: false,
    stopRequested: false,
    stopWaiters: new Set(),
    transactionId: null,
    meterWh: options.meterStartWh,
    stopped: false,
    connected: true
  };
  const signalCleanup = installSignalHandlers(client, options, state);

  try {
    const boot = await call(client, 'BootNotification', {
      chargePointVendor: 'Virtual OCPP',
      chargePointModel: 'Simulator',
      firmwareVersion: 'simulator-1'
    });
    console.log(`BootNotification: ${JSON.stringify(boot)}`);

    await call(client, 'StatusNotification', {
      connectorId: options.connectorId,
      errorCode: 'NoError',
      status: 'Available',
      timestamp: new Date().toISOString()
    });

    for (let index = 0; index < options.heartbeatCount; index += 1) {
      const heartbeat = await call(client, 'Heartbeat', {});
      console.log(`Heartbeat ${index + 1}/${options.heartbeatCount}: ${JSON.stringify(heartbeat)}`);
    }

    if (options.ensureTag) {
      await ensureTagAccess(options);
    }

    const authorization = await call(client, 'Authorize', { idTag: options.tagId }) as { idTagInfo?: { status?: string } };
    const authorizationStatus = authorization.idTagInfo?.status ?? 'Unknown';
    console.log(`Authorize ${options.tagId}: ${authorizationStatus}`);

    const start = await call(client, 'StartTransaction', {
      connectorId: options.connectorId,
      idTag: options.tagId,
      meterStart: options.meterStartWh,
      timestamp: new Date().toISOString()
    }) as { transactionId?: number; idTagInfo?: { status?: string } };
    const startStatus = start.idTagInfo?.status ?? 'Unknown';
    console.log(`StartTransaction: ${startStatus}, transactionId=${start.transactionId ?? 'none'}`);

    if (startStatus !== 'Accepted' || typeof start.transactionId !== 'number') {
      console.log('Transaction was not accepted. MeterValues and StopTransaction were skipped.');
      return;
    }
    state.transactionId = start.transactionId;

    await call(client, 'StatusNotification', {
      connectorId: options.connectorId,
      errorCode: 'NoError',
      status: 'Charging',
      timestamp: new Date().toISOString()
    });

    state.meterWh = await emitMeterValues(client, options, state);
    await stopActiveTransaction(client, options, state, 'Local');
    if (options.smoke) {
      console.log(`SMOKE OK: ${options.chargerId} completed transaction ${state.transactionId}`);
    }

    if (options.keepOpen) {
      console.log(`Keeping ${options.chargerId} online. Press Ctrl+C to stop.`);
      await keepHeartbeatLoop(client, options.heartbeatIntervalMs, state);
    }
  } finally {
    signalCleanup();
    if (state.transactionId !== null && !state.stopped) {
      await stopActiveTransaction(client, options, state, 'Local');
    }
    if (!options.keepOpen || state.stopRequested) {
      await client.close({});
      state.connected = false;
      console.log('Simulator disconnected.');
    }
  }
}

async function call(client: OcppClient, method: string, params: Record<string, unknown>) {
  console.log(`> ${method}`);
  return client.call(method, params);
}

async function emitMeterValues(client: OcppClient, options: SimulatorOptions, state: SimulatorRuntimeState) {
  if (options.runTimeMs !== null) {
    return emitTimedMeterValues(client, options, state);
  }

  for (let index = 0; index < options.meterSamples; index += 1) {
    if (state.stopRequested) break;
    state.meterWh += options.meterStepWh;
    if (index > 0) await sleep(options.sampleIntervalMs, state);
    if (state.stopRequested) break;
    await emitMeterValue(client, options, state.transactionId as number, state.meterWh);
    console.log(`MeterValues ${index + 1}/${options.meterSamples}: ${state.meterWh} Wh`);
  }
  return state.meterWh;
}

async function emitTimedMeterValues(client: OcppClient, options: SimulatorOptions, state: SimulatorRuntimeState) {
  const powerKw = options.powerKw ?? 11;
  const sampleCount = Math.max(1, Math.ceil((options.runTimeMs ?? 0) / options.sampleIntervalMs));
  let elapsedMs = 0;

  console.log(`Running timed charge for ${formatDuration(options.runTimeMs ?? 0)} at ${powerKw} kW.`);
  for (let index = 0; index < sampleCount; index += 1) {
    if (state.stopRequested) break;
    const nextElapsedMs = Math.min(options.runTimeMs ?? 0, elapsedMs + options.sampleIntervalMs);
    const intervalMs = nextElapsedMs - elapsedMs;
    await sleep(intervalMs, state);
    if (state.stopRequested) break;
    state.meterWh += Math.round(powerKw * 1000 * (intervalMs / 3_600_000));
    elapsedMs = nextElapsedMs;
    await emitMeterValue(client, options, state.transactionId as number, state.meterWh);
    console.log(`MeterValues ${index + 1}/${sampleCount}: ${state.meterWh} Wh after ${formatDuration(elapsedMs)}`);
  }

  return state.meterWh;
}

async function emitMeterValue(client: OcppClient, options: SimulatorOptions, transactionId: number, meterWh: number) {
  await call(client, 'MeterValues', {
    connectorId: options.connectorId,
    transactionId,
    meterValue: [
      {
        timestamp: new Date().toISOString(),
        sampledValue: [
          {
            value: String(meterWh),
            measurand: 'Energy.Active.Import.Register',
            unit: 'Wh',
            context: 'Sample.Periodic'
          }
        ]
      }
    ]
  });
}

async function stopActiveTransaction(client: OcppClient, options: SimulatorOptions, state: SimulatorRuntimeState, reason: string) {
  if (state.transactionId === null || state.stopped || state.stopping) return;

  state.stopping = true;
  try {
    const stop = await call(client, 'StopTransaction', {
      transactionId: state.transactionId,
      meterStop: state.meterWh,
      timestamp: new Date().toISOString(),
      reason
    });
    state.stopped = true;
    console.log(`StopTransaction: ${JSON.stringify(stop)}`);

    await call(client, 'StatusNotification', {
      connectorId: options.connectorId,
      errorCode: 'NoError',
      status: 'Available',
      timestamp: new Date().toISOString()
    });
  } finally {
    state.stopping = false;
  }
}

async function ensureTagAccess(options: SimulatorOptions) {
  if (!options.adminPassword) {
    throw new Error('--ensure-tag requires --admin-password or ADMIN_PASSWORD in the environment');
  }

  const cookie = await loginAdmin(options);
  let tags = await adminRequest<TagResponse[]>(options, '/api/tags', { cookie });
  let tag = tags.find((candidate) => candidate.uuid === options.tagId);

  if (!tag) {
    tag = await adminRequest<TagResponse>(options, '/api/tags', {
      method: 'POST',
      cookie,
      body: {
        uuid: options.tagId,
        label: `Simulator ${options.tagId}`,
        enabled: true
      }
    });
    console.log(`Created simulator tag ${options.tagId}`);
  } else if (!tag.enabled) {
    tag = await adminRequest<TagResponse>(options, `/api/tags/${encodeURIComponent(tag.id)}`, {
      method: 'PATCH',
      cookie,
      body: {
        enabled: true
      }
    });
    console.log(`Enabled simulator tag ${options.tagId}`);
  }

  tags = await adminRequest<TagResponse[]>(options, '/api/tags', { cookie });
  tag = tags.find((candidate) => candidate.uuid === options.tagId);
  if (!tag) throw new Error(`Tag ${options.tagId} was not found after creation`);

  const existingAccess = tag.chargerAccess?.find((access) => access.chargerId === options.chargerId);
  if (existingAccess?.enabled) {
    console.log(`Tag ${options.tagId} already has access to ${options.chargerId}`);
    return;
  }

  await adminRequest(options, `/api/tags/${encodeURIComponent(tag.id)}/chargers/${encodeURIComponent(options.chargerId)}`, {
    method: 'PUT',
    cookie,
    body: {
      enabled: true
    }
  });
  console.log(`Granted ${options.tagId} access to ${options.chargerId}`);
}

async function loginAdmin(options: SimulatorOptions) {
  const response = await fetch(`${options.adminUrl}/api/auth/login`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      username: options.adminUsername,
      password: options.adminPassword
    })
  });

  if (!response.ok) {
    throw new Error(`Admin login failed with HTTP ${response.status}`);
  }

  const cookie = response.headers.get('set-cookie');
  if (!cookie) throw new Error('Admin login did not return a session cookie');
  return cookie.split(';')[0];
}

async function adminRequest<T = unknown>(
  options: SimulatorOptions,
  path: string,
  request: {
    method?: string;
    cookie: string;
    body?: unknown;
  }
): Promise<T> {
  const response = await fetch(`${options.adminUrl}${path}`, {
    method: request.method ?? 'GET',
    headers: {
      cookie: request.cookie,
      ...(request.body === undefined ? {} : { 'content-type': 'application/json' })
    },
    body: request.body === undefined ? undefined : JSON.stringify(request.body)
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Admin request ${request.method ?? 'GET'} ${path} failed with HTTP ${response.status}: ${text}`);
  }

  return response.json() as Promise<T>;
}

async function keepHeartbeatLoop(client: OcppClient, intervalMs: number, state: SimulatorRuntimeState) {
  let count = 0;
  while (!state.stopRequested) {
    if (intervalMs > 0) await sleep(intervalMs, state);
    if (state.stopRequested) break;
    count += 1;
    const heartbeat = await call(client, 'Heartbeat', {});
    console.log(`Heartbeat keep-open ${count}: ${JSON.stringify(heartbeat)}`);
  }
}

function installSignalHandlers(client: OcppClient, options: SimulatorOptions, state: SimulatorRuntimeState) {
  const handleSignal = (signal: NodeJS.Signals) => {
    if (state.stopRequested) {
      console.error(`Received ${signal} again; exiting immediately.`);
      process.exit(130);
    }

    requestStop(state);
    console.log(`Received ${signal}; stopping simulator session.`);
    void stopActiveTransaction(client, options, state, 'Local')
      .catch((error: unknown) => {
        console.error(error instanceof Error ? error.message : error);
      })
      .finally(() => {
        if (state.connected) {
          void client.close({}).finally(() => {
            state.connected = false;
          });
        }
      });
  };

  process.on('SIGINT', handleSignal);
  process.on('SIGTERM', handleSignal);

  return () => {
    process.off('SIGINT', handleSignal);
    process.off('SIGTERM', handleSignal);
  };
}

function parsePositiveInteger(value: string, name: string) {
  const parsed = parseNonNegativeInteger(value, name);
  if (parsed < 1) throw new Error(`--${name} must be at least 1`);
  return parsed;
}

function parseNonNegativeInteger(value: string, name: string) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`--${name} must be a non-negative integer`);
  }
  return parsed;
}

function parseOptionalPositiveNumber(value: string | undefined, name: string) {
  if (value === undefined) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`--${name} must be a positive number`);
  }
  return parsed;
}

export function parseDurationMs(value: string, name: string) {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`--${name} must be a duration like 15m, 90s, or 1h`);
  if (/^\d+$/.test(trimmed)) return parsePositiveInteger(trimmed, name);

  const matches = [...trimmed.matchAll(/(\d+(?:\.\d+)?)(ms|s|m|h)/g)];
  if (matches.length === 0 || matches.map((match) => match[0]).join('') !== trimmed) {
    throw new Error(`--${name} must be a duration like 15m, 90s, or 1h`);
  }

  const totalMs = matches.reduce((total, match) => {
    const amount = Number(match[1]);
    const unit = match[2];
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new Error(`--${name} duration parts must be positive`);
    }
    const multiplier = unit === 'ms' ? 1 : unit === 's' ? 1000 : unit === 'm' ? 60_000 : 3_600_000;
    return total + amount * multiplier;
  }, 0);

  if (!Number.isInteger(totalMs) || totalMs <= 0) {
    throw new Error(`--${name} must resolve to a positive whole number of milliseconds`);
  }
  return totalMs;
}

function formatDuration(ms: number) {
  if (ms < 1000) return `${ms}ms`;
  if (ms % 3_600_000 === 0) return `${ms / 3_600_000}h`;
  if (ms % 60_000 === 0) return `${ms / 60_000}m`;
  if (ms % 1000 === 0) return `${ms / 1000}s`;
  return `${ms}ms`;
}

function isBooleanFlag(key: string) {
  return ['ensure-tag', 'keep-open', 'smoke', 'help'].includes(key);
}

function requestStop(state: SimulatorRuntimeState) {
  state.stopRequested = true;
  for (const resolve of state.stopWaiters) {
    resolve();
  }
  state.stopWaiters.clear();
}

function sleep(ms: number, state?: SimulatorRuntimeState) {
  if (!state) return new Promise((resolve) => setTimeout(resolve, ms));
  if (state.stopRequested) return Promise.resolve();

  return new Promise<void>((resolve) => {
    const done = () => {
      clearTimeout(timeout);
      state.stopWaiters.delete(done);
      resolve();
    };
    const timeout = setTimeout(done, ms);
    state.stopWaiters.add(done);
  });
}

function loadEnvFileFromKnownLocations() {
  const candidates = [
    resolve(process.cwd(), '.env'),
    resolve(process.cwd(), '..', '.env'),
    resolve(process.cwd(), '..', '..', '.env')
  ];
  const envPath = candidates.find((candidate) => existsSync(candidate));
  if (envPath) process.loadEnvFile(envPath);
}

function isMainModule() {
  return process.argv[1] === fileURLToPath(import.meta.url);
}

if (isMainModule()) {
  loadEnvFileFromKnownLocations();
  runSimulator(parseSimulatorArgs(process.argv.slice(2))).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
