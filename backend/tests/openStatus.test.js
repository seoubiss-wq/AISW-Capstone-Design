const test = require("node:test");
const assert = require("node:assert/strict");

const {
  isPlaceOpenNow,
  parseOpenNowOnly,
  readPlaceOpenNow,
} = require("../scripts/shared/openStatus");

test("parses the open now flag from request payloads", () => {
  assert.equal(parseOpenNowOnly(true), true);
  assert.equal(parseOpenNowOnly("true"), true);
  assert.equal(parseOpenNowOnly(false), false);
  assert.equal(parseOpenNowOnly("false"), false);
  assert.equal(parseOpenNowOnly(undefined), false);
});

test("treats only explicit open_now=true values as currently open", () => {
  assert.equal(
    isPlaceOpenNow({
      current_opening_hours: { open_now: true },
    }),
    true,
  );

  assert.equal(
    isPlaceOpenNow({
      opening_hours: { open_now: false },
    }),
    false,
  );

  assert.equal(
    isPlaceOpenNow({
      business_status: "OPERATIONAL",
    }),
    false,
  );
});

test("preserves unknown open-now metadata as null", () => {
  assert.equal(
    readPlaceOpenNow({
      business_status: "OPERATIONAL",
    }),
    null,
  );

  assert.equal(
    readPlaceOpenNow({
      opening_hours: { open_now: false },
    }),
    false,
  );
});
