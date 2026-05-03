import { env } from './config/env';
import { createApp } from './app';

const app = createApp();

app.listen(env.PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Paytag API listening on port ${env.PORT} (${env.NODE_ENV})`);
});
