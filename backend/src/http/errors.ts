import type { ErrorRequestHandler, RequestHandler } from 'express';
import { z } from 'zod';
import { log } from '../env';

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export const notFound = (what = 'Ressourcen') => new HttpError(404, `${what} findes ikke`);

export function parse<T extends z.ZodType>(schema: T, data: unknown): z.infer<T> {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new HttpError(400, 'Ugyldige data', result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
  }
  return result.data;
}

export const notFoundHandler: RequestHandler = (req, _res, next) => {
  next(new HttpError(404, `Ukendt endpoint: ${req.method} ${req.path}`));
};

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message, details: err.details });
    return;
  }
  if (err?.type === 'entity.parse.failed') {
    res.status(400).json({ error: 'Ugyldig JSON' });
    return;
  }
  log.error(`${req.method} ${req.originalUrl} fejlede`, { err: err instanceof Error ? err.stack : String(err) });
  res.status(500).json({ error: 'Der skete en uventet fejl' });
};
