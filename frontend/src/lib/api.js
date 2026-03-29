const API_BASE_URL =
  process.env.REACT_APP_API_BASE_URL?.replace(/\/$/, "") || "http://localhost:5500";

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

export async function request(path, options = {}, authToken = "") {
  const headers = {
    ...(options.body ? { "Content-Type": "application/json" } : {}),
    ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
    ...(options.headers || {}),
  };

  const response = await fetch(`${API_BASE_URL}${path}`, { ...options, headers });
  return readJson(response);
}
