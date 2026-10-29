import { NestFactory } from '@nestjs/core';
import { Logger, ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { ConfigService } from '@nestjs/config';
import { validateEnv } from './config/env.validation';
import { truthy } from './common/utils/truthy';

async function bootstrap() {
  validateEnv(process.env);

  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService);
  const logger = new Logger('Bootstrap');

  app.enableShutdownHooks();
  app.getHttpAdapter().getInstance().set('trust proxy', 1);

  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );

  const origins = new Set(config.get<string[]>('corsOrigins') || []);
  const allowVercelPreviews = truthy(
    process.env.CORS_ALLOW_VERCEL_PREVIEWS ?? 'true',
  );
  app.enableCors({
    origin: (
      origin: string | undefined,
      callback: (err: Error | null, allow?: boolean) => void,
    ) => {
      if (!origin || origins.has(origin)) {
        callback(null, true);
        return;
      }
      if (
        allowVercelPreviews &&
        /^https:\/\/[a-z0-9-]+\.vercel\.app$/i.test(origin)
      ) {
        callback(null, true);
        return;
      }
      callback(null, false);
    },
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    credentials: true,
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-Admin-Token',
      'X-Pipeline-Admin-Token',
      'Cache-Control',
      'Pragma',
    ],
    exposedHeaders: ['Content-Type', 'Content-Disposition'],
    maxAge: 86400,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidUnknownValues: false,
    }),
  );

  const host = config.get<string>('api.host') || '0.0.0.0';
  const port = config.get<number>('api.port') || 5000;

  await app.listen(port, host);
  logger.log(
    'MediaSphere NestJS (Phase 1-3) listening on http://' +
      host +
      ':' +
      String(port),
  );
  logger.log(
    'Read path: GET /api/health /api/database/health /api/news /api/news/stats /api/notifications/status',
  );
  logger.log(
    'Control plane: /api/admin/auth/* /api/admin/fetch/* /api/admin/upload/* /api/admin/scheduler/status /api/admin/health ' +
      '/api/pipeline/health POST /api/pipeline/run-now',
  );
  if (config.get<boolean>('pipeline.onApi')) {
    logger.log('PIPELINE_ON_API=true: this process owns the news schedule.');
  } else {
    logger.log('PIPELINE_ON_API=false: the news schedule is off.');
  }
}

bootstrap();
