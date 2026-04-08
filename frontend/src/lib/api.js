function resolveApiBaseUrl() {
  const envApiBaseUrl = String(import.meta.env.REACT_APP_API_BASE_URL || "").trim().replace(/\/$/, "");

  if (!import.meta.env.PROD) {
    return envApiBaseUrl || "http://localhost:5500";
  }

  if (!envApiBaseUrl) {
    return "";
  }

  try {
    const parsed = new URL(envApiBaseUrl);
    if (["localhost", "127.0.0.1"].includes(parsed.hostname)) {
      return "";
    }
  } catch {}

  return envApiBaseUrl;
}

const API_BASE_URL = resolveApiBaseUrl();

export function resolveApiUrl(path) {
  if (!path) return path;
  if (/^https?:\/\//i.test(path)) {
    return path;
  }
  if (!API_BASE_URL) {
    return path;
  }
  return `${API_BASE_URL}${path.startsWith("/") ? "" : "/"}${path}`;
}

export async function readJson(response) {
  const contentType = response.headers.get("content-type") || "";
  const payload = contentType.includes("application/json") ? await response.json() : {};

  if (!response.ok) {
    const error = new Error(payload.error || "?붿껌??泥섎━?섏? 紐삵뻽?듬땲??");
    error.status = response.status;
    throw error;
  }

  return payload;
}

export async function request(path, options = {}) {
  const headers = {
    ...(options.body ? { "Content-Type": "application/json" } : {}),
    ...(options.headers || {}),
  };

  const response = await fetch(resolveApiUrl(path), {
    ...options,
    credentials: "include",
    headers,
  });
  return readJson(response);
}
