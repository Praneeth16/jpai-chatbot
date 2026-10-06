import { createApp, lakebase, server } from '@databricks/appkit';
import { runMigrations } from './db/migrate';
import { withTransactions } from './db/transaction';
import { loadConfig } from './router/config';
import { createStore } from './router/store';
import { initTracing, otelTracer } from './router/trace';
import { registerRoutes } from './routes';
import type { Appkit } from './types';

createApp({
  plugins: [lakebase(), server()],
  async onPluginsReady(appkit) {
    const kit = appkit as unknown as Appkit;
    await runMigrations(kit.lakebase);
    await initTracing();
    registerRoutes(kit, {
      store: createStore(withTransactions(kit.lakebase)),
      config: loadConfig(),
      tracer: otelTracer,
    });
  },
}).catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
