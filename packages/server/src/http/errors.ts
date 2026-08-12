import type { NextFunction, Request, Response } from 'express';
import { ZodError, type ZodTypeAny, type z } from 'zod';
import { ConflictError, NotFoundError } from '../db/repository.js';

export class BadRequestError extends Error {
  readonly code = 'bad_request';
  constructor(
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'BadRequestError';
  }
}

/** Parse a request body, turning a schema failure into a 400 with the issues. */
export function parseBody<TSchema extends ZodTypeAny>(
  schema: TSchema,
  body: unknown,
): z.infer<TSchema> {
  const result = schema.safeParse(body);
  if (!result.success) {
    throw new BadRequestError('The request body is not valid', formatIssues(result.error));
  }
  return result.data;
}

export function formatIssues(error: ZodError): { path: string; message: string }[] {
  return error.issues.map((issue) => ({
    path: issue.path.join('.') || '(root)',
    message: issue.message,
  }));
}

/**
 * Read a required path parameter.
 *
 * Express types `req.params.x` as possibly undefined, and it genuinely can be
 * when a route is mounted differently than expected — so this fails as a 400
 * rather than passing `undefined` into a database lookup.
 */
export function pathParam(req: Request, name: string): string {
  const value = req.params[name];
  if (typeof value !== 'string' || value.length === 0) {
    throw new BadRequestError(`Missing path parameter "${name}"`);
  }
  return value;
}

/** Wrap an async handler so a rejected promise reaches the error middleware. */
export function asyncHandler(
  handler: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    handler(req, res, next).catch(next);
  };
}

export function errorMiddleware(
  error: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (error instanceof NotFoundError) {
    res.status(404).json({ error: { code: error.code, message: error.message } });
    return;
  }
  if (error instanceof ConflictError) {
    res.status(409).json({ error: { code: error.code, message: error.message } });
    return;
  }
  if (error instanceof BadRequestError) {
    res
      .status(400)
      .json({ error: { code: error.code, message: error.message, details: error.details } });
    return;
  }
  if (error instanceof ZodError) {
    // A schema failure that escaped the boundary means the server built a
    // response it could not validate — that is a bug here, not a client error.
    console.error('[server] response failed its own schema:', error.issues);
    res.status(500).json({
      error: {
        code: 'response_validation_failed',
        message: 'The server produced a response that did not match its contract',
        details: formatIssues(error),
      },
    });
    return;
  }

  console.error('[server] unhandled error:', error);
  res.status(500).json({
    error: {
      code: 'internal_error',
      message: error instanceof Error ? error.message : 'Something went wrong',
    },
  });
}
