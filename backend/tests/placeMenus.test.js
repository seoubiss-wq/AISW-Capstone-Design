const test = require("node:test");
const assert = require("node:assert/strict");

const {
  extractPlaceMenus,
} = require("../scripts/shared/placeMenus");

test("extracts actual menu names from summary and reviews", () => {
  const menus = extractPlaceMenus({
    summary: "봉골레 파스타와 고르곤졸라 피자가 유명한 이탈리안 식당입니다.",
    reviews: [
      { text: "봉골레 파스타가 진짜 맛있고, 고르곤졸라 피자도 도우가 쫄깃해요." },
      { text: "재방문하면 봉골레 파스타랑 리조또 또 먹을 것 같아요." },
    ],
  });

  assert.deepEqual(
    menus.map((menu) => menu.name).slice(0, 3),
    ["봉골레 파스타", "고르곤졸라 피자", "리조또"],
  );
  assert.equal(menus[0].mentionCount, 3);
});

test("filters out generic single-mention categories when specific menus exist", () => {
  const menus = extractPlaceMenus({
    reviews: [
      { text: "커피도 괜찮았지만 말차라떼가 진하고 디저트랑 잘 어울렸어요." },
    ],
  });

  assert.deepEqual(menus.map((menu) => menu.name), ["말차라떼"]);
});

test("returns an empty list when no menu-like phrases are present", () => {
  const menus = extractPlaceMenus({
    summary: "좌석이 넓고 직원분들이 친절해요.",
    reviews: [
      { text: "분위기가 조용해서 대화하기 좋았습니다." },
    ],
  });

  assert.deepEqual(menus, []);
});
