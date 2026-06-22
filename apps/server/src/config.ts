import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';

const ConfigSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(8797),
  HOST: z.string().min(1).default('0.0.0.0'),
  SQLITE_PATH: z.string().min(1).default('./data/virtual-ocpp.sqlite'),
  DB_PATH: z.string().min(1).optional(),
  SESSION_SECRET: z.string().min(32, 'SESSION_SECRET must be at least 32 characters'),
  ADMIN_USERNAME: z.string().min(1).default('admin'),
  ADMIN_PASSWORD: z.string().min(1, 'ADMIN_PASSWORD must not be empty'),
  OCPP_BASIC_AUTH_PASSWORD: optionalNonEmptyString(),
  OCPP_PUBLIC_URL: optionalNonEmptyString(),
  COMMUNICATION_LOG_RETENTION_HOURS: z.coerce.number().int().positive().default(24),
  CHARGER_SILENT_AFTER_SECONDS: z.coerce.number().int().positive().default(300),
  METER_GAP_THRESHOLD_WH: z.coerce.number().int().nonnegative().default(1000)
});

function optionalNonEmptyString() {
  return z.preprocess((value) => (value === '' ? undefined : value), z.string().min(1).optional());
}

export type AppConfig = {
  nodeEnv: 'development' | 'test' | 'production';
  port: number;
  host: string;
  sqlitePath: string;
  sessionSecret: string;
  adminUsername: string;
  adminPassword: string;
  ocppBasicAuthPassword?: string;
  ocppPublicUrl?: string;
  communicationLogRetentionHours: number;
  chargerSilentAfterSeconds: number;
  meterGapThresholdWh: number;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = ConfigSchema.safeParse(env);

  if (!parsed.success) {
    throw new Error(
      `Invalid environment: ${parsed.error.issues.map((issue) => `${issue.path.join('.') || 'env'} ${issue.message}`).join('; ')}`
    );
  }

  const sqlitePath = parsed.data.DB_PATH ?? parsed.data.SQLITE_PATH;
  const productionSecretErrors = validateProductionSecrets(parsed.data);
  if (productionSecretErrors.length > 0) {
    throw new Error(`Invalid environment: ${productionSecretErrors.join('; ')}`);
  }

  return {
    nodeEnv: parsed.data.NODE_ENV,
    port: parsed.data.PORT,
    host: parsed.data.HOST,
    sqlitePath,
    sessionSecret: parsed.data.SESSION_SECRET,
    adminUsername: parsed.data.ADMIN_USERNAME,
    adminPassword: parsed.data.ADMIN_PASSWORD,
    ocppBasicAuthPassword: parsed.data.OCPP_BASIC_AUTH_PASSWORD,
    ocppPublicUrl: parsed.data.OCPP_PUBLIC_URL,
    communicationLogRetentionHours: parsed.data.COMMUNICATION_LOG_RETENTION_HOURS,
    chargerSilentAfterSeconds: parsed.data.CHARGER_SILENT_AFTER_SECONDS,
    meterGapThresholdWh: parsed.data.METER_GAP_THRESHOLD_WH
  };
}

function validateProductionSecrets(data: z.infer<typeof ConfigSchema>) {
  if (data.NODE_ENV !== 'production') {
    return [];
  }

  const errors: string[] = [];
  if (data.SESSION_SECRET === 'replace-with-at-least-32-random-characters') {
    errors.push('SESSION_SECRET must be replaced before production startup');
  }
  if (data.ADMIN_PASSWORD === 'replace-me' || data.ADMIN_PASSWORD === 'replace-me-with-at-least-8-characters') {
    errors.push('ADMIN_PASSWORD must be replaced before production startup');
  }
  return errors;
}

export function loadConfigFromProcess(): AppConfig {
  loadEnvFileFromKnownLocations();
  return loadConfig();
}

function loadEnvFileFromKnownLocations() {
  const candidates = [
    resolve(process.cwd(), '.env'),
    resolve(process.cwd(), '..', '.env'),
    resolve(process.cwd(), '..', '..', '.env')
  ];

  const envPath = candidates.find((candidate) => existsSync(candidate));
  if (envPath) {
    process.loadEnvFile(envPath);
  }
}
