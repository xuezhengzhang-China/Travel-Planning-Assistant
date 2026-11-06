import { Injectable } from '@nestjs/common';
import { ConfigService } from '../config/config.service';

export function readBConfig(env: NodeJS.ProcessEnv) {
  function number(name: string, fallback: number, max: number) {
    const value = env[name] === undefined ? fallback : Number(env[name]);
    if (!Number.isSafeInteger(value) || value < 1 || value > max)
      throw new Error(`Invalid ${name}`);
    return value;
  }
  if (env.B_LLM_ENABLED !== undefined && !['true', 'false'].includes(env.B_LLM_ENABLED))
    throw new Error('Invalid B_LLM_ENABLED');
  const llmEnabled = env.B_LLM_ENABLED === 'true';
  const llmBaseUrl = env.LLM_API_BASE_URL?.trim() || '';
  const llmKey = env.LLM_API_KEY?.trim() || '';
  const llmModel = env.LLM_MODEL?.trim() || '';
  if (llmEnabled) {
    if (!llmBaseUrl || !llmKey || !llmModel)
      throw new Error('Enabled LLM requires base URL, key and model');
    let url: URL;
    try {
      url = new URL(llmBaseUrl);
    } catch {
      throw new Error('Invalid LLM_API_BASE_URL');
    }
    if (
      (url.protocol !== 'https:' &&
        !(
          url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
        )) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      throw new Error('Invalid LLM_API_BASE_URL');
  }
  return {
    amapKey: env.AMAP_WEB_SERVICE_KEY?.trim() || '',
    externalTimeoutMs: number('B_EXTERNAL_TIMEOUT_MS', 3000, 15000),
    maxRouteCalls: number('B_MAX_ROUTE_CALLS', 40, 120),
    proposalTtlMinutes: number('B_PROPOSAL_TTL_MINUTES', 30, 120),
    generationTimeoutMs: number('B_GENERATION_TIMEOUT_MS', 20000, 60000),
    llmEnabled,
    llmBaseUrl,
    llmKey,
    llmModel,
    llmTimeoutMs: number('B_LLM_TIMEOUT_MS', 15000, 60000),
  };
}
@Injectable()
export class BConfig {
  readonly values: ReturnType<typeof readBConfig>;
  constructor(config: ConfigService) {
    // ConfigService loads the workspace .env before this provider reads optional B settings.
    void config.values;
    this.values = readBConfig(process.env);
  }
}
