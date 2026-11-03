import { createApp } from './app';
import { ConfigService } from './config/config.service';

async function bootstrap() {
  const app = await createApp();
  app.enableShutdownHooks();
  await app.listen(app.get(ConfigService).values.port, '0.0.0.0');
}

void bootstrap().catch(() => {
  console.error('API startup failed. Check configuration and whether the port is available.');
  process.exitCode = 1;
});
