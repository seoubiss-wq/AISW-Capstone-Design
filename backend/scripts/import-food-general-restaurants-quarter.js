require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });

const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");
const { TextDecoder } = require("util");
const { buildDbSslConfig } = require("./shared/dbConfig");

const DATABASE_URL = (
  process.env.DATABASE_URL ||
  process.env.SUPABASE_DB_URL ||
  process.env.SUPABASE_DATABASE_URL ||
  ""
).trim();

const PROJECT_ROOT = path.join(__dirname, "..", "..");
const TABLE_NAME = "public.food_general_restaurants_quarter";
const BATCH_SIZE = 500;
const IMPORT_SAMPLE_BUCKET = 1;
const SAMPLE_MODULO = 4;

const COLUMN_SPECS = [
  { source: "개방자치단체코드", target: "local_government_code", parse: parseText },
  { source: "관리번호", target: "management_no", parse: parseText, required: true },
  { source: "인허가일자", target: "license_date", parse: parseDate },
  { source: "영업상태명", target: "business_status_name", parse: parseText },
  { source: "폐업일자", target: "closure_date", parse: parseDate },
  { source: "소재지면적", target: "site_area", parse: parseNumber },
  { source: "소재지우편번호", target: "site_postal_code", parse: parseText },
  { source: "도로명우편번호", target: "road_postal_code", parse: parseText },
  { source: "사업장명", target: "business_name", parse: parseText },
  { source: "업태구분명", target: "business_type_name", parse: parseText },
  { source: "데이터갱신구분", target: "data_update_type", parse: parseText },
  { source: "건물소유구분명", target: "building_ownership_name", parse: parseText },
  { source: "공장사무직직원수", target: "factory_office_worker_count", parse: parseInteger },
  { source: "공장생산직직원수", target: "factory_production_worker_count", parse: parseInteger },
  { source: "공장판매직직원수", target: "factory_sales_worker_count", parse: parseInteger },
  { source: "급수시설구분명", target: "water_supply_type_name", parse: parseText },
  { source: "남성종사자수", target: "male_worker_count", parse: parseInteger },
  { source: "다중이용업소여부", target: "multi_use_business_yn", parse: parseText },
  { source: "데이터갱신시점", target: "data_update_at", parse: parseTimestamp },
  { source: "도로명주소", target: "road_address", parse: parseText },
  { source: "등급구분명", target: "grade_name", parse: parseText },
  { source: "보증액", target: "deposit_amount", parse: parseNumber },
  { source: "본사직원수", target: "head_office_worker_count", parse: parseInteger },
  { source: "상세영업상태명", target: "detailed_business_status_name", parse: parseText },
  { source: "상세영업상태코드", target: "detailed_business_status_code", parse: parseText },
  { source: "시설총규모", target: "total_facility_size", parse: parseNumber },
  { source: "여성종사자수", target: "female_worker_count", parse: parseInteger },
  { source: "영업상태코드", target: "business_status_code", parse: parseText },
  { source: "영업장주변구분명", target: "surrounding_business_area_name", parse: parseText },
  { source: "월세액", target: "monthly_rent_amount", parse: parseNumber },
  { source: "위생업태명", target: "sanitation_business_type_name", parse: parseText },
  { source: "전통업소주된음식", target: "traditional_main_food", parse: parseText },
  { source: "전통업소지정번호", target: "traditional_designation_no", parse: parseText },
  { source: "전화번호", target: "phone_number", parse: parseText },
  { source: "좌표정보(X)", target: "coordinate_x", parse: parseNumber },
  { source: "좌표정보(Y)", target: "coordinate_y", parse: parseNumber },
  { source: "지번주소", target: "lot_address", parse: parseText },
  { source: "홈페이지", target: "homepage_url", parse: parseText },
  { source: "최종수정시점", target: "last_modified_at", parse: parseTimestamp },
];

if (!DATABASE_URL) {
  console.error("DATABASE_URL or SUPABASE_DB_URL is required.");
  process.exit(1);
}

function parseCsvLine(line) {
  const values = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];

    if (char === '"') {
      if (inQuotes && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      values.push(current);
      current = "";
      continue;
    }

    current += char;
  }

  values.push(current);
  return values;
}

function parseText(value) {
  const normalized = String(value || "").trim();
  return normalized || null;
}

function parseInteger(value) {
  const normalized = parseText(value);
  if (!normalized) return null;
  const parsed = Number.parseInt(normalized.replace(/,/g, ""), 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseNumber(value) {
  const normalized = parseText(value);
  if (!normalized) return null;
  const parsed = Number.parseFloat(normalized.replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function parseDate(value) {
  const normalized = parseText(value);
  if (!normalized) return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : null;
}

function parseTimestamp(value) {
  const normalized = parseText(value);
  if (!normalized) return null;
  return /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(normalized)
    ? normalized
    : null;
}

function shouldImportQuarterRow(dataRowNumber) {
  return ((dataRowNumber - 1) % SAMPLE_MODULO) + 1 === IMPORT_SAMPLE_BUCKET;
}

function resolveCsvFilePath() {
  const fileName = fs
    .readdirSync(PROJECT_ROOT)
    .find((name) => name.endsWith(".csv") && name.includes("식품_일반음식점"));

  if (!fileName) {
    throw new Error("식품_일반음식점 CSV 파일을 찾지 못했습니다.");
  }

  return path.join(PROJECT_ROOT, fileName);
}

async function* streamDecodedLines(filePath, encoding = "euc-kr") {
  const decoder = new TextDecoder(encoding);
  const stream = fs.createReadStream(filePath);
  let pending = "";

  for await (const chunk of stream) {
    pending += decoder.decode(chunk, { stream: true });

    while (true) {
      const newlineIndex = pending.indexOf("\n");
      if (newlineIndex === -1) {
        break;
      }

      let line = pending.slice(0, newlineIndex);
      if (line.endsWith("\r")) {
        line = line.slice(0, -1);
      }
      yield line;
      pending = pending.slice(newlineIndex + 1);
    }
  }

  pending += decoder.decode();
  if (pending) {
    const finalLine = pending.endsWith("\r") ? pending.slice(0, -1) : pending;
    if (finalLine) {
      yield finalLine;
    }
  }
}

function mapRowToRecord(headers, values, sourceRowNumber, sampleBucket) {
  const raw = {};
  headers.forEach((header, index) => {
    raw[header] = values[index] ?? "";
  });

  const record = {
    source_row_number: sourceRowNumber,
    sample_bucket: sampleBucket,
  };

  for (const spec of COLUMN_SPECS) {
    const parsed = spec.parse(raw[spec.source]);
    if (spec.required && !parsed) {
      return null;
    }
    record[spec.target] = parsed;
  }

  return record;
}

function buildInsertValues(records) {
  const columns = [...COLUMN_SPECS.map((spec) => spec.target), "source_row_number", "sample_bucket"];
  const params = [];
  const rows = records.map((record, rowIndex) => {
    const placeholders = columns.map((column, columnIndex) => {
      params.push(record[column] ?? null);
      return `$${rowIndex * columns.length + columnIndex + 1}`;
    });
    return `(${placeholders.join(", ")})`;
  });

  return { columns, rows, params };
}

async function ensureTable(client) {
  await client.query(`
    create table if not exists ${TABLE_NAME} (
      management_no text primary key,
      local_government_code text,
      license_date date,
      business_status_name text,
      closure_date date,
      site_area double precision,
      site_postal_code text,
      road_postal_code text,
      business_name text,
      business_type_name text,
      data_update_type text,
      building_ownership_name text,
      factory_office_worker_count integer,
      factory_production_worker_count integer,
      factory_sales_worker_count integer,
      water_supply_type_name text,
      male_worker_count integer,
      multi_use_business_yn text,
      data_update_at timestamp,
      road_address text,
      grade_name text,
      deposit_amount double precision,
      head_office_worker_count integer,
      detailed_business_status_name text,
      detailed_business_status_code text,
      total_facility_size double precision,
      female_worker_count integer,
      business_status_code text,
      surrounding_business_area_name text,
      monthly_rent_amount double precision,
      sanitation_business_type_name text,
      traditional_main_food text,
      traditional_designation_no text,
      phone_number text,
      coordinate_x double precision,
      coordinate_y double precision,
      lot_address text,
      homepage_url text,
      last_modified_at timestamp,
      source_row_number integer not null,
      sample_bucket smallint not null,
      created_at timestamptz not null default timezone('utc', now()),
      updated_at timestamptz not null default timezone('utc', now())
    )
  `);

  await client.query(
    `create index if not exists idx_food_general_restaurants_quarter_business_name
       on ${TABLE_NAME} (business_name)`,
  );
  await client.query(
    `create index if not exists idx_food_general_restaurants_quarter_status_name
       on ${TABLE_NAME} (business_status_name)`,
  );
  await client.query(
    `create index if not exists idx_food_general_restaurants_quarter_business_type
       on ${TABLE_NAME} (business_type_name)`,
  );
  await client.query(
    `create index if not exists idx_food_general_restaurants_quarter_road_address
       on ${TABLE_NAME} using gin (to_tsvector('simple', coalesce(road_address, '')))`,
  );
}

async function insertBatch(client, records) {
  if (!records.length) return 0;

  const { columns, rows, params } = buildInsertValues(records);
  const query = `
    insert into ${TABLE_NAME} (${columns.join(", ")})
    values ${rows.join(", ")}
    on conflict (management_no) do nothing
  `;

  const result = await client.query(query, params);
  return result.rowCount || 0;
}

async function countRows(client) {
  const result = await client.query(`select count(*)::int as count from ${TABLE_NAME}`);
  return result.rows[0]?.count || 0;
}

async function importQuarterSample() {
  const csvPath = resolveCsvFilePath();
  const pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: buildDbSslConfig({ connectionString: DATABASE_URL }),
    max: 2,
  });

  const client = await pool.connect();

  try {
    await ensureTable(client);

    let headers = null;
    let sourceRowNumber = 0;
    let importedRows = 0;
    let sampledRowsProcessed = 0;
    let malformedRows = 0;
    let batch = [];

    for await (const line of streamDecodedLines(csvPath)) {
      sourceRowNumber += 1;

      if (!headers) {
        headers = parseCsvLine(line);
        continue;
      }

      const dataRowNumber = sourceRowNumber - 1;
      const sampleBucket = ((dataRowNumber - 1) % SAMPLE_MODULO) + 1;
      if (sampleBucket !== IMPORT_SAMPLE_BUCKET) {
        continue;
      }

      const values = parseCsvLine(line);
      if (values.length !== headers.length) {
        malformedRows += 1;
        continue;
      }

      const record = mapRowToRecord(headers, values, sourceRowNumber, sampleBucket);
      if (!record) {
        malformedRows += 1;
        continue;
      }

      batch.push(record);
      if (batch.length < BATCH_SIZE) {
        continue;
      }

      importedRows += await insertBatch(client, batch);
      sampledRowsProcessed += batch.length;
      batch = [];

      if (sampledRowsProcessed % 20000 === 0) {
        console.log(`processed ${sampledRowsProcessed.toLocaleString("en-US")} sampled rows...`);
      }
    }

    if (batch.length) {
      importedRows += await insertBatch(client, batch);
      sampledRowsProcessed += batch.length;
    }

    const totalRows = await countRows(client);
    console.log(`table: ${TABLE_NAME}`);
    console.log(`csv: ${csvPath}`);
    console.log(`sample bucket: ${IMPORT_SAMPLE_BUCKET}/${SAMPLE_MODULO}`);
    console.log(`sampled rows processed: ${sampledRowsProcessed.toLocaleString("en-US")}`);
    console.log(`rows inserted this run: ${importedRows.toLocaleString("en-US")}`);
    console.log(`malformed sampled rows skipped: ${malformedRows.toLocaleString("en-US")}`);
    console.log(`table rows total: ${totalRows.toLocaleString("en-US")}`);
  } finally {
    client.release();
    await pool.end();
  }
}

async function main() {
  try {
    await importQuarterSample();
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  COLUMN_SPECS,
  buildInsertValues,
  mapRowToRecord,
  parseCsvLine,
  parseDate,
  parseInteger,
  parseNumber,
  parseText,
  parseTimestamp,
  resolveCsvFilePath,
  streamDecodedLines,
  shouldImportQuarterRow,
};
