import { errorHandler } from "../utils/errorHandler";

const fsmApiKey =
  (import.meta.env as any).VITE_FSM_API_KEY ||
  (import.meta.env as any).FSM_API_KEY ||
  "";

if (!fsmApiKey) {
  console.warn("[FSM] WARNING: FSM API key not found in environment (VITE_FSM_API_KEY / FSM_API_KEY)");
} else {
  console.log(`[FSM] API key loaded: ${fsmApiKey.substring(0, 8)}...`);
}

async function fetchFSMData(param: string, method: "GET" | "POST" = "GET") {
  console.log('hello')
  const safeParam = param.startsWith('/') ? param : `/${param}`;
  const url = `https://fsm846.vercel.app/api/v1${safeParam}`;
  console.log(url)
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10_000);

  try {
    const headers: Record<string, string> = {};
    if (fsmApiKey) {
      headers["X-API-Key"] = fsmApiKey;
    }

    const response = await fetch(url, {
      method,
      headers,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!response.ok) {
      console.warn(`[FSM] HTTP ${response.status} ${response.statusText} for ${param}`);
      return undefined;
    }

    const contentType = response.headers.get("content-type") || "";
    const text = await response.text();
    console.log("HERE", text)
    if (!contentType.includes("application/json") && text.trim().startsWith("<")) {
      console.warn(`[FSM] Received HTML response for ${param}`);
      return undefined;
    }

    try {
      
      const data = JSON.parse(text);
      if (data?.error) {
        console.warn(`[FSM] API error for ${param}:`, data.error.message || data.error);
        return undefined;
      }
      
      return data;
    } catch (parseError) {
      console.warn(`[FSM] Failed to parse JSON response for ${param}`);
      return undefined;
    }
  } catch (error) {
    clearTimeout(timeoutId);
    if (error instanceof Error && error.name === "AbortError") {
      console.warn(`[FSM] Request timed out after 10s for ${param}`);
      return undefined;
    }
    console.warn(`[FSM] Fetch failed for ${param}:`, error);
    return undefined;
  }
}

export { fetchFSMData };
