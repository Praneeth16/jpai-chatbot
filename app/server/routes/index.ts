import type { Deps } from '../router/orchestrator';
import type { Appkit } from '../types';
import { registerDocsEndpoints } from './docs';
import { registerOpsEndpoint } from './ops';
import { registerRouteEndpoint } from './route';
import { registerSectionsEndpoint } from './sections';
import { registerSystemEndpoints } from './system';

export function registerRoutes(appkit: Appkit, deps: Deps): void {
  appkit.server.extend((app) => {
    registerRouteEndpoint(app, deps);
    registerSectionsEndpoint(app, deps);
    registerDocsEndpoints(app, appkit.lakebase);
    registerOpsEndpoint(app, appkit.lakebase);
    registerSystemEndpoints(app, appkit.lakebase);
  });
}
