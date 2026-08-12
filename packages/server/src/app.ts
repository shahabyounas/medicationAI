import express, { type Express } from 'express';
import cors from 'cors';
import { apiRouter } from './routes/index.js';
import { errorMiddleware } from './http/errors.js';

export function createApp(): Express {
  const app = express();

  app.use(cors());
  app.use(express.json({ limit: '1mb' }));

  app.use('/api', apiRouter);

  app.use((_req, res) => {
    res.status(404).json({ error: { code: 'not_found', message: 'No such endpoint' } });
  });

  app.use(errorMiddleware);
  return app;
}
