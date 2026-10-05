import { dbxJson } from '../router/dbx';

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** catalog.schema from DOCS_VOLUME (/Volumes/<catalog>/<schema>/docs). */
export function ucNames(volume: string | undefined = process.env.DOCS_VOLUME): { catalog: string; schema: string } {
  const m = /^\/Volumes\/([^/]+)\/([^/]+)\//.exec(`${volume ?? ''}/`);
  if (!m || !IDENT.test(m[1].replace(/-/g, '_')) || !IDENT.test(m[2])) {
    throw new Error('DOCS_VOLUME must look like /Volumes/<catalog>/<schema>/<volume>');
  }
  return { catalog: m[1], schema: m[2] };
}

export const tbl = (name: string): string => {
  const { catalog, schema } = ucNames();
  return `\`${catalog}\`.\`${schema}\`.\`${name}\``;
};

interface StatementResponse {
  status: { state: string; error?: { message?: string } };
  result?: { data_array?: (string | null)[][] };
}

/** Runs one statement on the app warehouse as the app service principal. Rows come back as strings. */
export async function runSql(statement: string, timeoutS = 20): Promise<(string | null)[][]> {
  const warehouse = process.env.DATABRICKS_WAREHOUSE_ID;
  if (!warehouse) throw new Error('DATABRICKS_WAREHOUSE_ID is not set');
  const res = await dbxJson<StatementResponse>('/api/2.0/sql/statements', {
    method: 'POST',
    json: {
      warehouse_id: warehouse,
      statement,
      wait_timeout: `${timeoutS}s`,
      on_wait_timeout: 'CANCEL',
      format: 'JSON_ARRAY',
      disposition: 'INLINE',
    },
    timeoutMs: (timeoutS + 10) * 1000,
  });
  if (res.status.state !== 'SUCCEEDED') {
    throw new Error(`statement ${res.status.state}: ${res.status.error?.message ?? ''}`);
  }
  return res.result?.data_array ?? [];
}
