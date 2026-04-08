const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildDbSslConfig,
  getDatabaseHostname,
  isLocalDatabase,
  isSupabaseDatabase,
  loadDbSslCa,
  normalizeDbSslCa,
  SUPABASE_ROOT_2021_CA,
} = require("../scripts/shared/dbConfig");

test("recognizes localhost database urls as local", () => {
  assert.equal(isLocalDatabase("postgres://user:pass@localhost:5432/app"), true);
  assert.equal(isLocalDatabase("postgres://user:pass@db.example.com:5432/app"), false);
});

test("enables certificate verification for remote databases", () => {
  assert.deepEqual(
    buildDbSslConfig({
      connectionString: "postgres://user:pass@db.example.com:5432/app",
    }),
    { rejectUnauthorized: true },
  );
});

test("preserves multiline CA bundles from environment strings", () => {
  assert.equal(normalizeDbSslCa("line1\\nline2"), "line1\nline2");
});

test("extracts database hostnames safely", () => {
  assert.equal(
    getDatabaseHostname("postgres://user:pass@aws-1-ap-northeast-2.pooler.supabase.com:5432/app"),
    "aws-1-ap-northeast-2.pooler.supabase.com",
  );
  assert.equal(getDatabaseHostname("not-a-url"), "");
});

test("recognizes supabase hosts", () => {
  assert.equal(
    isSupabaseDatabase("postgres://user:pass@aws-1-ap-northeast-2.pooler.supabase.com:5432/app"),
    true,
  );
  assert.equal(
    isSupabaseDatabase("postgres://user:pass@db.example.com:5432/app"),
    false,
  );
});

test("uses the supabase root CA for supabase hosts by default", () => {
  assert.equal(
    loadDbSslCa({
      connectionString: "postgres://user:pass@aws-1-ap-northeast-2.pooler.supabase.com:5432/app",
    }),
    SUPABASE_ROOT_2021_CA,
  );
});

test("prefers an explicitly configured CA bundle over the supabase default", () => {
  assert.equal(
    loadDbSslCa({
      connectionString: "postgres://user:pass@aws-1-ap-northeast-2.pooler.supabase.com:5432/app",
      dbSslCa: "custom-root",
    }),
    "custom-root",
  );
});

test("injects the supabase root CA into the SSL config", () => {
  assert.deepEqual(
    buildDbSslConfig({
      connectionString: "postgres://user:pass@aws-1-ap-northeast-2.pooler.supabase.com:5432/app",
    }),
    { rejectUnauthorized: true, ca: SUPABASE_ROOT_2021_CA },
  );
});
