import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module.js';
import { ACCESS_TOKEN_COOKIE } from './auth/auth.constants.js';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter.js';
import { createValidationPipe } from './common/pipes/validation.pipe.js';

async function bootstrap() {
  // rawBody: keeps the exact request bytes in req.rawBody, needed to verify
  // Stripe webhook signatures (PAY-01, Youssef Khafagy). JSON parsing is unchanged.
  const app = await NestFactory.create(AppModule, { rawBody: true });
  const config = app.get(ConfigService);

  app.setGlobalPrefix('api');
  app.use(cookieParser());
  app.useGlobalPipes(createValidationPipe());
  app.useGlobalFilters(new AllExceptionsFilter());

  const frontendUrl = config.get<string>('FRONTEND_URL');
  if (frontendUrl) {
    // Cookies are only sent cross-origin when credentials are enabled.
    app.enableCors({ origin: frontendUrl, credentials: true });
  }

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Travel Planning and Booking Platform API')
    .setDescription(
      'Milestone 1 backend. Log in with POST /api/auth/login: the browser stores the httpOnly ' +
        'cookies and sends them with every "Try it out" request automatically. ' +
        'Errors always use the ErrorResponseDto shape. Lists are paginated with page size 10.',
    )
    .setVersion('1.0')
    .addCookieAuth(ACCESS_TOKEN_COOKIE)
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api/docs', app, document, {
    swaggerOptions: { withCredentials: true, persistAuthorization: true },
  });

  const port = config.get<number>('PORT') ?? 3000;
  await app.listen(port);
  const logger = new Logger('Bootstrap');
  logger.log(`API:     http://localhost:${port}/api`);
  logger.log(`Swagger: http://localhost:${port}/api/docs`);
}
await bootstrap();
