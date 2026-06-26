import { z } from 'zod';

const ConfigSchema = z.object({
  VIRTUAL_OCPP_API_URL: z.string().url(),
  VIRTUAL_OCPP_API_TOKEN: z.string().min(1)
});

export type AppConfig = {
  apiUrl: string;
  apiToken: string;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = ConfigSchema.safeParse(env);
  if (!parsed.success) {
    throw new Error(
      `Invalid environment: ${parsed.error.issues.map((issue) => `${issue.path.join('.') || 'env'} ${issue.message}`).join('; ')}`
    );
  }

  return {
    apiUrl: parsed.data.VIRTUAL_OCPP_API_URL,
    apiToken: parsed.data.VIRTUAL_OCPP_API_TOKEN
  };
}
