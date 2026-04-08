const test = require("node:test");
const assert = require("node:assert/strict");
const { spawn, spawnSync } = require("node:child_process");
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

test("server.js starts successfully with the frontend catch-all enabled", async (t) => {
  const serverPath = path.join(__dirname, "..", "server.js");
  const port = 5613;

  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [serverPath], {
      cwd: path.join(__dirname, ".."),
      env: {
        ...process.env,
        PORT: String(port),
        DATABASE_URL: "postgres://localhost:5432/tastepick_test",
        SUPABASE_DB_URL: "",
        SUPABASE_DATABASE_URL: "",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let combinedOutput = "";
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error(`server did not start in time\n${combinedOutput}`));
    }, 10000);

    const finish = (error) => {
      clearTimeout(timeout);
      child.stdout.removeAllListeners();
      child.stderr.removeAllListeners();
      child.removeAllListeners();
      if (!child.killed) {
        child.kill();
      }
      if (error) {
        reject(error);
        return;
      }
      resolve();
    };

    child.stdout.on("data", (chunk) => {
      combinedOutput += chunk.toString();
      if (combinedOutput.includes(`Server http://localhost:${port}`)) {
        finish();
      }
    });

    child.stderr.on("data", (chunk) => {
      combinedOutput += chunk.toString();
    });

    child.on("exit", (code) => {
      if (code === null) {
        return;
      }
      finish(new Error(`server exited early with code ${code}\n${combinedOutput}`));
    });

    t.after(() => {
      clearTimeout(timeout);
      if (!child.killed) {
        child.kill();
      }
    });
  });
});
