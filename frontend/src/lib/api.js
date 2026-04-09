export function resolveApiBaseUrl(env = import.meta.env) {
  const forceSameOrigin =
    String(env.REACT_APP_FORCE_SAME_ORIGIN || "")
      .trim()
      .toLowerCase() === "true";

  if (forceSameOrigin) {
    return "";
  }

  const envApiBaseUrl = String(env.REACT_APP_API_BASE_URL || "").trim().replace(/\/$/, "");

  if (!envApiBaseUrl) {
    return "";
  }

  try {
    const parsed = new URL(envApiBaseUrl);
    if (["localhost", "127.0.0.1"].includes(parsed.hostname)) {
      return "";
    }
  } catch {}

  if (!env.PROD) {
    return envApiBaseUrl;
  }

  return envApiBaseUrl;
}

export function resolveApiUrl(path, env = import.meta.env) {
  if (!path) return path;
  if (/^https?:\/\//i.test(path)) {
    return path;
  }

  const apiBaseUrl = resolveApiBaseUrl(env);
  if (!apiBaseUrl) {
    return path;
  }

  return `${apiBaseUrl}${path.startsWith("/") ? "" : "/"}${path}`;
}

export async function readJson(response) {
  const contentType = response.headers.get("content-type") || "";
  const payload = contentType.includes("application/json") ? await response.json() : {};

  if (!response.ok) {
    const error = new Error(payload.error || "요청을 처리하지 못했습니다.");
    error.status = response.status;
    error.code = payload.code || "";
    error.payload = payload;
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
