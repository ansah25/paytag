import express, { Application } from 'express';
import cors from 'cors';
import { router } from './routes';
import { errorHandler } from './middleware/errorHandler';

export const createApp = (): Application => {
  const app = express();

  app.use(cors());
  app.use(express.json({ limit: '100kb' }));

  app.use(router);

  app.use((_req, res) => {
    res.status(404).json({ error: 'Not found', code: 404 });
  });

  app.use(errorHandler);

  return app;
};
