const test = require("node:test");
const assert = require("node:assert/strict");

const {
  mapRowToRecord,
  parseCsvLine,
  shouldImportQuarterRow,
} = require("../scripts/import-food-general-restaurants-quarter");

test("parseCsvLine handles quoted commas and escaped quotes", () => {
  const values = parseCsvLine('3000000,"서울, 종로구","참스 ""CHARMS""",영업/정상');
  assert.deepEqual(values, ["3000000", "서울, 종로구", '참스 "CHARMS"', "영업/정상"]);
});

test("shouldImportQuarterRow keeps every fourth row starting from the first", () => {
  assert.equal(shouldImportQuarterRow(1), true);
  assert.equal(shouldImportQuarterRow(2), false);
  assert.equal(shouldImportQuarterRow(4), false);
  assert.equal(shouldImportQuarterRow(5), true);
});

test("mapRowToRecord converts csv strings into typed columns", () => {
  const headers = [
    "개방자치단체코드",
    "관리번호",
    "인허가일자",
    "영업상태명",
    "폐업일자",
    "소재지면적",
    "소재지우편번호",
    "도로명우편번호",
    "사업장명",
    "업태구분명",
    "데이터갱신구분",
    "건물소유구분명",
    "공장사무직직원수",
    "공장생산직직원수",
    "공장판매직직원수",
    "급수시설구분명",
    "남성종사자수",
    "다중이용업소여부",
    "데이터갱신시점",
    "도로명주소",
    "등급구분명",
    "보증액",
    "본사직원수",
    "상세영업상태명",
    "상세영업상태코드",
    "시설총규모",
    "여성종사자수",
    "영업상태코드",
    "영업장주변구분명",
    "월세액",
    "위생업태명",
    "전통업소주된음식",
    "전통업소지정번호",
    "전화번호",
    "좌표정보(X)",
    "좌표정보(Y)",
    "지번주소",
    "홈페이지",
    "최종수정시점",
  ];

  const values = [
    "3000000",
    "3000000-101-2026-00055",
    "2026-03-27",
    "영업/정상",
    "",
    "78.80",
    "110-847",
    "03009",
    "명동칼국수 샤브샤브 종로평창점",
    "한식",
    "I",
    "",
    "",
    "",
    "",
    "",
    "",
    "N",
    "2026-03-28 22:47:57",
    "서울특별시 종로구 평창문화로 75",
    "",
    "",
    "",
    "영업",
    "01",
    "78.8",
    "",
    "01",
    "",
    "",
    "한식",
    "",
    "",
    "",
    "197212.364862058",
    "456055.205802855",
    "서울특별시 종로구 평창동 158-1 글로리아타운",
    "",
    "2026-03-27 10:35:06",
  ];

  const record = mapRowToRecord(headers, values, 3, 1);

  assert.equal(record.management_no, "3000000-101-2026-00055");
  assert.equal(record.business_name, "명동칼국수 샤브샤브 종로평창점");
  assert.equal(record.license_date, "2026-03-27");
  assert.equal(record.site_area, 78.8);
  assert.equal(record.coordinate_x, 197212.364862058);
  assert.equal(record.coordinate_y, 456055.205802855);
  assert.equal(record.source_row_number, 3);
  assert.equal(record.sample_bucket, 1);
});
