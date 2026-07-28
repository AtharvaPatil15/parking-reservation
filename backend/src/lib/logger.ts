import pino from 'pino';
import { env } from '../config/env';

/**
 * Structured logger with PII masking (F12). Redacts credentials + personal data
 * so email/contact/address/PIN never land in logs.
 */
export const logger = pino({
  level: env.LOG_LEVEL,
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'password',
      'confirmPassword',
      'passwordHash',
      '*.password',
      '*.confirmPassword',
      '*.passwordHash',
      '*.email',
      '*.contactNumber',
      '*.address',
      '*.pinCode',
      'req.body.password',
      'req.body.confirmPassword',
      'req.body.email',
      'req.body.contactNumber',
      'req.body.address',
      'req.body.pinCode',
    ],
    censor: '[redacted]',
  },
});
