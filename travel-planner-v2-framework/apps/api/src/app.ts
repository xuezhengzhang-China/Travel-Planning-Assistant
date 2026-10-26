import 'reflect-metadata';
import type { NestApplicationOptions } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ConfigService } from './config/config.service';

export async function createApp(options?: NestApplicationOptions) {
  const app = await NestFactory.create(AppModule, options);
  app.setGlobalPrefix('api');
  app.enableCors({ origin: app.get(ConfigService).values.corsOrigins });
  return app;
}
