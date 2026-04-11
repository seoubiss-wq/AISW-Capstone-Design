const MAX_MENU_ITEMS = 6;
const MAX_SNIPPET_LENGTH = 72;

const MENU_KEYWORDS = Array.from(new Set([
  "아메리카노",
  "카페라떼",
  "말차라떼",
  "바닐라라떼",
  "카푸치노",
  "티라미수",
  "크루아상",
  "샌드위치",
  "에그베네딕트",
  "프렌치토스트",
  "팬케이크",
  "브런치",
  "샐러드",
  "파스타",
  "리조또",
  "피자",
  "스테이크",
  "버거",
  "타코",
  "부리토",
  "케밥",
  "오마카세",
  "사시미",
  "스시",
  "초밥",
  "돈카츠",
  "돈까스",
  "텐동",
  "규동",
  "카레",
  "우동",
  "소바",
  "라멘",
  "쌀국수",
  "분짜",
  "팟타이",
  "나시고렝",
  "마라샹궈",
  "마라탕",
  "훠궈",
  "딤섬",
  "양꼬치",
  "짜장면",
  "짬뽕",
  "탕수육",
  "볶음밥",
  "오므라이스",
  "비빔밥",
  "덮밥",
  "국밥",
  "곰탕",
  "설렁탕",
  "갈비탕",
  "갈비찜",
  "갈비",
  "불고기",
  "삼겹살",
  "오겹살",
  "목살",
  "보쌈",
  "족발",
  "닭갈비",
  "닭볶음탕",
  "찜닭",
  "치킨",
  "곱창",
  "막창",
  "대창",
  "육회",
  "물회",
  "회덮밥",
  "냉면",
  "밀면",
  "칼국수",
  "수제비",
  "만두",
  "떡볶이",
  "순대",
  "순두부찌개",
  "된장찌개",
  "김치찌개",
  "부대찌개",
  "감자탕",
  "샤브샤브",
  "해장국",
  "아구찜",
  "낙곱새",
  "빙수",
  "아이스크림",
  "와플",
  "케이크",
  "도넛",
  "타르트",
  "에이드",
  "스무디",
  "커피",
])).sort((left, right) => right.length - left.length);

const LEADING_NOISE_PATTERN = /^(여기|이집|저는|우리는|특히|가장|대표|시그니처|추천|인기|유명한|주문한|먹은|먹어본|제일|정말|진짜|매콤한|담백한|고소한|부드러운)\s+/;
const TRAILING_NOISE_PATTERN = /\s+(맛집|식당|메뉴|요리|안주|세트|코스)$/;
const GENERIC_MENU_NAMES = new Set([
  "브런치",
  "샐러드",
  "커피",
  "케이크",
  "치킨",
  "갈비",
]);
const SNIPPET_TRIM_PATTERN = /[“”"'`()[\]{}]/g;
const TRAILING_PARTICLE_LOOKAHEAD = "(?=$|[^0-9A-Za-z가-힣]|(?:은|는|이|가|을|를|와|과|도|랑|으로|로|에|에서|만|까지|부터))";
const PREFIX_STOPWORDS = new Set([
  "여기",
  "이집",
  "저는",
  "우리는",
  "특히",
  "대표",
  "시그니처",
  "추천",
  "인기",
  "유명한",
  "주문한",
  "먹은",
  "먹어본",
  "제일",
  "정말",
  "진짜",
  "재방문하면",
]);

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function splitIntoSegments(value) {
  return normalizeText(value)
    .split(/[\n\r]+|[.!?]|[|]|[·]|[•]|…/g)
    .map((part) => normalizeText(part))
    .filter((part) => part.length >= 4);
}

function shouldKeepPrefixToken(token) {
  const normalized = normalizeText(token).replace(/[^0-9A-Za-z가-힣&+./-]/g, "");
  if (!normalized) return false;
  if (PREFIX_STOPWORDS.has(normalized)) return false;
  if (/(했|하면|하며|하고|하지만|였다|였고|였는데|네요|어요|아요|같|좋|괜찮|맛있|먹|주문|추천|재방문)/.test(normalized)) {
    return false;
  }
  if (/(은|는|이|가|을|를|도|만|랑|와|과)$/.test(normalized) && normalized.length > 2) {
    return false;
  }
  return true;
}

function cleanMenuName(name, keyword) {
  const normalized = normalizeText(name);
  const keywordIndex = normalized.toLowerCase().lastIndexOf(String(keyword || "").toLowerCase());
  const keywordEnd =
    keywordIndex >= 0 ? keywordIndex + String(keyword || "").length : normalized.length;
  const prefix = keywordIndex > 0 ? normalized.slice(0, keywordIndex) : "";
  const prefixParts = prefix
    .split(/\b(?:and|with)\b|[,/]|(?:하고|하며|이랑|랑|와|과|및)/)
    .map((part) => normalizeText(part));
  const trimmedPrefix = prefixParts.length ? prefixParts[prefixParts.length - 1] : "";
  const rawPrefixTokens = trimmedPrefix.split(/\s+/).filter(Boolean);
  const prefixTokens = [];

  for (let index = rawPrefixTokens.length - 1; index >= 0 && prefixTokens.length < 3; index -= 1) {
    if (!shouldKeepPrefixToken(rawPrefixTokens[index])) {
      break;
    }
    prefixTokens.unshift(rawPrefixTokens[index]);
  }

  let candidate = normalizeText(`${prefixTokens.join(" ")} ${normalized.slice(keywordIndex >= 0 ? keywordIndex : 0, keywordEnd)}`)
    .replace(SNIPPET_TRIM_PATTERN, "")
    .replace(/^[,/:;~-]+|[,/:;~-]+$/g, "");

  while (LEADING_NOISE_PATTERN.test(candidate)) {
    candidate = candidate.replace(LEADING_NOISE_PATTERN, "");
  }

  candidate = candidate.replace(TRAILING_NOISE_PATTERN, "");
  candidate = candidate.replace(/\s{2,}/g, " ").trim();

  if (!candidate || candidate.length < 2 || candidate.length > 24) {
    return "";
  }

  if (/^(메뉴|음식|요리|식사|디저트|주류)$/.test(candidate)) {
    return "";
  }

  return candidate;
}

function buildSnippet(text) {
  const snippet = normalizeText(text).replace(SNIPPET_TRIM_PATTERN, "");
  if (!snippet) return "";
  return snippet.length > MAX_SNIPPET_LENGTH
    ? `${snippet.slice(0, MAX_SNIPPET_LENGTH).trim()}...`
    : snippet;
}

function extractCandidatesFromText(text) {
  const candidates = [];

  for (const keyword of MENU_KEYWORDS) {
    const pattern = new RegExp(
      `(?:^|[^0-9A-Za-z가-힣])((?:[0-9A-Za-z가-힣&+./-]{0,12}(?:\\s+[0-9A-Za-z가-힣&+./-]{1,12}){0,2}\\s*)?${escapeRegex(keyword)})${TRAILING_PARTICLE_LOOKAHEAD}`,
      "gi",
    );

    for (const match of text.matchAll(pattern)) {
      const name = cleanMenuName(match[1], keyword);
      if (!name) continue;
      candidates.push(name);
    }
  }

  return candidates;
}

function compareMenus(left, right) {
  if (right.score !== left.score) {
    return right.score - left.score;
  }

  if (right.name.length !== left.name.length) {
    return right.name.length - left.name.length;
  }

  return left.name.localeCompare(right.name, "ko");
}

function extractPlaceMenus(placeLike) {
  const summary = normalizeText(placeLike?.summary || placeLike?.editorial_summary?.overview || placeLike?.editorial_summary);
  const reviews = Array.isArray(placeLike?.reviews) ? placeLike.reviews : [];
  const segments = [];

  if (summary) {
    for (const segment of splitIntoSegments(summary)) {
      segments.push({ source: "summary", text: segment });
    }
  }

  for (const review of reviews) {
    const text = normalizeText(review?.text);
    if (!text) continue;
    for (const segment of splitIntoSegments(text)) {
      segments.push({ source: "review", text: segment });
    }
  }

  const menuMap = new Map();

  for (const segment of segments) {
    const candidates = extractCandidatesFromText(segment.text);
    if (!candidates.length) continue;

    for (const candidate of candidates) {
      const key = candidate.toLowerCase();
      const entry = menuMap.get(key) || {
        id: `menu-${menuMap.size + 1}`,
        name: candidate,
        description: buildSnippet(segment.text),
        mentionCount: 0,
        score: 0,
      };

      entry.mentionCount += 1;
      entry.score += segment.source === "summary" ? 2 : 1;

      if (!entry.description || segment.source === "summary") {
        entry.description = buildSnippet(segment.text);
      }

      menuMap.set(key, entry);
    }
  }

  return Array.from(menuMap.values())
    .filter((entry) => {
      if (entry.mentionCount > 1) return true;
      return !GENERIC_MENU_NAMES.has(entry.name);
    })
    .sort(compareMenus)
    .slice(0, MAX_MENU_ITEMS)
    .map((entry) => ({
      id: entry.id,
      name: entry.name,
      description: entry.description || "리뷰에서 언급된 대표 메뉴",
      mentionCount: entry.mentionCount,
    }));
}

module.exports = {
  extractPlaceMenus,
};
