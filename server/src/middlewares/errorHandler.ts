import { ZodError } from 'zod';
import { Request, Response, NextFunction } from 'express';
import { config } from '../config';

export const errorHandler = (
  err: any,
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const rawStatus = err instanceof ZodError ? 400 : Number(err.status);
  const status = rawStatus >= 400 && rawStatus < 600 ? rawStatus : 500;
  if (status >= 500) {
    console.error('Unhandled Server Error:', err?.message || err, err?.stack);
  }
  const message = status >= 500
    ? 'Internal server error'
    : err instanceof ZodError ? err.issues[0]?.message || 'Invalid request' : err.message || 'Internal server error occurred';

  res.status(status).json({
    success: false,
    message,
    
  });
};
