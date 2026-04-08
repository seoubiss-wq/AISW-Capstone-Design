const test = require("node:test");
const assert = require("node:assert/strict");

const { runNonCriticalOperation } = require("../scripts/shared/nonCriticalOperation");

test("runNonCriticalOperation returns the original result when the operation succeeds", async () => {
  const result = await runNonCriticalOperation(async () => "ok", {
    fallbackValue: "fallback",
  });

  assert.equal(result, "ok");
});

test("runNonCriticalOperation returns the fallback value when the operation fails", async () => {
  let capturedMessage = "";
  const result = await runNonCriticalOperation(async () => {
    throw new Error("cache offline");
  }, {
    fallbackValue: null,
    onError(error) {
      capturedMessage = error.message;
    },
  });

  assert.equal(result, null);
  assert.equal(capturedMessage, "cache offline");
});
