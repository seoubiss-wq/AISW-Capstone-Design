require("dotenv").config({ path: "./.env" });

const { Client } = require("pg");

const SOURCE_URL = process.env.DEV_DATABASE_URL || "";
const TARGET_URL = process.env.PROD_DATABASE_URL || process.env.TARGET_DATABASE_URL || "";

function quoteIdent(value) {
  return `"${String(value).replace(/"/g, "\"\"")}"`;
}

function parseConnectionString(connectionString) {
  return new URL(connectionString);
}

function buildPoolerFallbackConnectionString(sourceConnectionString, targetConnectionString) {
  const sourceUrl = parseConnectionString(sourceConnectionString);
  const targetUrl = parseConnectionString(targetConnectionString);
  const sourceHost = sourceUrl.hostname;
  if (!sourceHost.includes(".pooler.supabase.com")) {
    return null;
  }

  const targetProjectRef = targetUrl.hostname.replace(/^db\./, "").replace(/\.supabase\.co$/i, "");
  if (!targetProjectRef) {
    return null;
  }

  const password = decodeURIComponent(targetUrl.password || "");
  if (!password) {
    return null;
  }

  const user = `postgres.${targetProjectRef}`;
  return `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${sourceHost}:${sourceUrl.port || 5432}/postgres`;
}

async function connectWithFallback(connectionString, sourceConnectionString) {
  const directClient = new Client({ connectionString, ssl: { rejectUnauthorized: false } });
  try {
    await directClient.connect();
    return directClient;
  } catch (error) {
    await directClient.end().catch(() => {});
    const fallbackConnectionString = buildPoolerFallbackConnectionString(sourceConnectionString, connectionString);
    if (!fallbackConnectionString) {
      throw error;
    }

    const fallbackClient = new Client({
      connectionString: fallbackConnectionString,
      ssl: { rejectUnauthorized: false },
    });
    await fallbackClient.connect();
    return fallbackClient;
  }
}

async function fetchRows(client, text, values = []) {
  const { rows } = await client.query(text, values);
  return rows;
}

async function loadPublicSchema(source) {
  const extensions = await fetchRows(
    source,
    `select extname
       from pg_extension
      where extname not in ('plpgsql')
      order by extname`,
  );

  const functions = await fetchRows(
    source,
    `select p.proname,
            pg_get_functiondef(p.oid) as definition
       from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
      order by p.proname`,
  );

  const tables = await fetchRows(
    source,
    `select tablename
       from pg_tables
      where schemaname = 'public'
      order by tablename`,
  );

  const tableDefs = [];
  for (const { tablename } of tables) {
    const columns = await fetchRows(
      source,
      `select a.attname as column_name,
              format_type(a.atttypid, a.atttypmod) as data_type,
              a.attnotnull as not_null,
              a.attidentity as identity_mode,
              a.attgenerated as generated_mode,
              pg_get_expr(ad.adbin, ad.adrelid) as default_expr
         from pg_attribute a
         join pg_class c on c.oid = a.attrelid
         join pg_namespace n on n.oid = c.relnamespace
         left join pg_attrdef ad on ad.adrelid = a.attrelid and ad.adnum = a.attnum
        where n.nspname = 'public'
          and c.relname = $1
          and a.attnum > 0
          and not a.attisdropped
        order by a.attnum`,
      [tablename],
    );

    const constraints = await fetchRows(
      source,
      `select conname,
              contype,
              pg_get_constraintdef(oid) as definition
         from pg_constraint
        where connamespace = 'public'::regnamespace
          and conrelid = $1::regclass
        order by case when contype = 'f' then 1 else 0 end, conname`,
      [`public.${tablename}`],
    );

    const indexes = await fetchRows(
      source,
      `select i.indexname,
              i.indexdef
         from pg_indexes i
        where i.schemaname = 'public'
          and i.tablename = $1
        order by i.indexname`,
      [tablename],
    );

    const triggers = await fetchRows(
      source,
      `select t.tgname,
              pg_get_triggerdef(t.oid, true) as definition
         from pg_trigger t
         join pg_class c on c.oid = t.tgrelid
         join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public'
          and c.relname = $1
          and not t.tgisinternal
        order by t.tgname`,
      [tablename],
    );

    tableDefs.push({ tablename, columns, constraints, indexes, triggers });
  }

  return { extensions, functions, tableDefs };
}

function buildCreateTableSql({ tablename, columns }) {
  const lines = columns.map((column) => {
    const parts = [quoteIdent(column.column_name), column.data_type];

    if (column.generated_mode === "s" && column.default_expr) {
      parts.push(`GENERATED ALWAYS AS (${column.default_expr}) STORED`);
    } else if (column.identity_mode === "a") {
      parts.push("GENERATED ALWAYS AS IDENTITY");
    } else if (column.identity_mode === "d") {
      parts.push("GENERATED BY DEFAULT AS IDENTITY");
    } else if (column.default_expr) {
      parts.push(`DEFAULT ${column.default_expr}`);
    }

    if (column.not_null) {
      parts.push("NOT NULL");
    }

    return `  ${parts.join(" ")}`;
  });

  return `CREATE TABLE public.${quoteIdent(tablename)} (\n${lines.join(",\n")}\n);`;
}

async function applyPublicSchema(target, schema) {
  for (const { extname } of schema.extensions) {
    if (extname === "pg_stat_statements") continue;
    await target.query(`create extension if not exists ${quoteIdent(extname)} with schema extensions`);
  }

  for (const fn of schema.functions) {
    await target.query(fn.definition);
  }

  for (const table of schema.tableDefs) {
    await target.query(buildCreateTableSql(table));
  }

  for (const table of schema.tableDefs) {
    for (const constraint of table.constraints.filter((entry) => entry.contype !== "f")) {
      await target.query(
        `alter table public.${quoteIdent(table.tablename)} add constraint ${quoteIdent(constraint.conname)} ${constraint.definition}`,
      );
    }
  }

  for (const table of schema.tableDefs) {
    for (const constraint of table.constraints.filter((entry) => entry.contype === "f")) {
      await target.query(
        `alter table public.${quoteIdent(table.tablename)} add constraint ${quoteIdent(constraint.conname)} ${constraint.definition}`,
      );
    }
  }

  for (const table of schema.tableDefs) {
    const constraintIndexNames = new Set(table.constraints.map((entry) => entry.conname));
    for (const index of table.indexes) {
      if (constraintIndexNames.has(index.indexname)) continue;
      await target.query(index.indexdef);
    }
  }

  for (const table of schema.tableDefs) {
    for (const trigger of table.triggers) {
      await target.query(trigger.definition);
    }
  }
}

async function main() {
  if (!SOURCE_URL) {
    throw new Error("DEV_DATABASE_URL is required.");
  }
  if (!TARGET_URL) {
    throw new Error("PROD_DATABASE_URL or TARGET_DATABASE_URL is required.");
  }

  const source = new Client({ connectionString: SOURCE_URL, ssl: { rejectUnauthorized: false } });
  const target = await connectWithFallback(TARGET_URL, SOURCE_URL);

  try {
    await source.connect();

    const targetPublicTables = await fetchRows(
      target,
      `select tablename from pg_tables where schemaname = 'public' order by tablename`,
    );
    if (targetPublicTables.length > 0) {
      throw new Error(`Target public schema is not empty: ${targetPublicTables.map((row) => row.tablename).join(", ")}`);
    }

    const schema = await loadPublicSchema(source);
    await applyPublicSchema(target, schema);

    const clonedTables = await fetchRows(
      target,
      `select tablename from pg_tables where schemaname = 'public' order by tablename`,
    );

    console.log(
      JSON.stringify(
        {
          clonedTableCount: clonedTables.length,
          clonedTables: clonedTables.map((row) => row.tablename),
          clonedFunctionCount: schema.functions.length,
        },
        null,
        2,
      ),
    );
  } finally {
    await source.end().catch(() => {});
    await target.end().catch(() => {});
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
