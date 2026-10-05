import { createApp, lakebase, server } from '@databricks/appkit';
import { runMigrations } from './db/migrate';
import { withTransactions } from './db/transaction';
import { loadConfig } from './router/config';
import { createStore } from './router/store';
import { initTracing, mlflowTracer } from './router/trace';
import { registerRoutes } from './routes';
import type { Appkit } from './types';

createApp({
  plugins: [lakebase(), server()],
  async onPluginsReady(appkit) {
    const kit = appkit as unknown as Appkit;
    await runMigrations(kit.lakebase);
    initTracing();
    registerRoutes(kit, {
      store: createStore(withTransactions(kit.lakebase)),
      config: loadConfig(),
      tracer: mlflowTracer,
    });
  },
}).catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
