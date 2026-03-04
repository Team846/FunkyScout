import { handleError } from "../../utils/errorHandler";

type fetchMethod = "POST" | "GET" | "OPTIONS";

const nexusApiKey = import.meta.env.VITE_NEXUS_API_KEY;

async function fetchNexusData(param: string, method: fetchMethod) {
  const url = `https://frc.nexus/api/v1${param}`;
  console.log("[Nexus Fetch] Requesting:", url);

  if (!nexusApiKey) {
    console.warn("[Nexus Fetch] API key not configured (VITE_NEXUS_API_KEY)");
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10_000); // 10s timeout

  try {
    const response = await fetch(url, {
      method: method,
      headers: {
        "Nexus-Api-Key": nexusApiKey,
      },
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    console.log("[Nexus Fetch] Response status:", response.status);

    if (!response.ok) {
      throw new Error(`HTTP error: ${response.status}`);
    }

    const data = await response.json();
    console.log("[Nexus Fetch] Success, received data");
    return data;
  } catch (error) {
    clearTimeout(timeoutId);
    if (error instanceof Error && error.name === "AbortError") {
      console.error("[Nexus Fetch] Request timed out after 10s");
      return undefined;
    }
    console.error("[Nexus Fetch] Error:", error);
    handleError(error);
    return undefined;
  }
}

export { fetchNexusData };
