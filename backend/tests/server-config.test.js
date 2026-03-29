const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

test("server.js exits with a clear error when DATABASE_URL is missing", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "tastepick-backend-test-"));
  const serverPath = path.join(__dirname, "..", "server.js");

  try {
    const result = spawnSync(process.execPath, [serverPath], {
      cwd: tempDir,
      encoding: "utf8",
      env: {
        ...process.env,
        DATABASE_URL: "",
        SUPABASE_DB_URL: "",
        SUPABASE_DATABASE_URL: "",
      },
      timeout: 10000,
    });

    const combinedOutput = `${result.stdout}\n${result.stderr}`;

    assert.notStrictEqual(result.status, 0);
    assert.match(combinedOutput, /DATABASE_URL 또는 SUPABASE_DB_URL이 필요합니다/);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
