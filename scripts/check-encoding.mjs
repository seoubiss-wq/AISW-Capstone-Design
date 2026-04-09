import fs from "node:fs";
import path from "node:path";

const ROOT_DIR = process.cwd();
const SELF_PATH = path.join("scripts", "check-encoding.mjs");
const IGNORE_DIRS = new Set([
  ".git",
  ".codex-logs",
  ".gstack",
  "node_modules",
  "build",
  "dist",
]);
const TEXT_EXTENSIONS = new Set([
  ".js",
  ".jsx",
  ".ts",
  ".tsx",
  ".mjs",
  ".cjs",
  ".json",
  ".md",
  ".html",
  ".css",
  ".yml",
  ".yaml",
  ".sql",
  ".txt",
]);
const TEXT_FILENAMES = new Set([
  ".editorconfig",
  ".gitattributes",
  ".gitignore",
  "AGENTS.md",
  "README.md",
]);
const SUSPICIOUS_PATTERNS = [
  {
    label: "replacement character",
    test: (line) => line.includes("\uFFFD"),
  },
  {
    label: "mixed CJK and Hangul mojibake",
    test: (line) => /[\u4E00-\u9FFF][가-힣]|[가-힣][\u4E00-\u9FFF]/.test(line),
  },
  {
    label: "latin-1 utf8 mojibake",
    test: (line) => /(Ã.|Â.|ì.|ë.|ê.)/.test(line),
  },
];

function shouldIgnoreDir(relativePath) {
  const segments = relativePath.split(path.sep);
  return segments.some((segment) => IGNORE_DIRS.has(segment));
}

function shouldCheckFile(relativePath) {
  if (relativePath === SELF_PATH) return false;
  if (shouldIgnoreDir(relativePath)) return false;

  const baseName = path.basename(relativePath);
  if (TEXT_FILENAMES.has(baseName)) return true;

  return TEXT_EXTENSIONS.has(path.extname(relativePath));
}

function walk(dirPath, relativeDir = "") {
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const entryRelativePath = relativeDir
      ? path.join(relativeDir, entry.name)
      : entry.name;
    const entryFullPath = path.join(dirPath, entry.name);

    if (entry.isDirectory()) {
      if (!shouldIgnoreDir(entryRelativePath)) {
        files.push(...walk(entryFullPath, entryRelativePath));
      }
      continue;
    }

    if (shouldCheckFile(entryRelativePath)) {
      files.push(entryRelativePath);
    }
  }

  return files;
}

function inspectFile(relativePath) {
  const fullPath = path.join(ROOT_DIR, relativePath);
  const contents = fs.readFileSync(fullPath, "utf8");
  const lines = contents.split(/\r?\n/);
  const findings = [];

  lines.forEach((line, index) => {
    const matchedPattern = SUSPICIOUS_PATTERNS.find((pattern) => pattern.test(line));
    if (!matchedPattern) return;

    findings.push({
      lineNumber: index + 1,
      label: matchedPattern.label,
      preview: line.trim().slice(0, 140),
    });
  });

  return findings;
}

const findings = [];

for (const relativePath of walk(ROOT_DIR)) {
  const fileFindings = inspectFile(relativePath);
  if (fileFindings.length > 0) {
    findings.push({ relativePath, fileFindings });
  }
}

if (findings.length === 0) {
  console.log("Encoding check passed. No suspicious mojibake patterns found.");
  process.exit(0);
}

console.error("Encoding check failed. Suspicious text patterns found:");
for (const { relativePath, fileFindings } of findings) {
  for (const finding of fileFindings) {
    console.error(
      `- ${relativePath}:${finding.lineNumber} [${finding.label}] ${finding.preview}`,
    );
  }
}

process.exit(1);
