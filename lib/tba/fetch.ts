import { handleError } from "../../utils/errorHandler";
type fetchMethod = "POST" | "GET" | "OPTIONS";

const tbaAuthKey = import.meta.env.VITE_X_TBA_AUTH_KEY;

// Log API key status on module load
if (!tbaAuthKey) {
   console.error("[TBA] CRITICAL: TBA API key not found in environment variables!");
   console.error("[TBA] Check that VITE_X_TBA_AUTH_KEY is set in .env file");
} else {
   console.log(`[TBA] API key loaded: ${tbaAuthKey.substring(0, 10)}...`);
}

async function fetchTBAData(param: string, method: fetchMethod) {
   const url = `https://www.thebluealliance.com/api/v3${param}`;

   if (!tbaAuthKey) {
      console.error("[TBA] Cannot fetch: API key not loaded");
      return undefined;
   }

   try {
      const response = await fetch(url, {
         method: method,
         headers: {
            "X-TBA-Auth-Key": tbaAuthKey,
         },
      });

      if (!response.ok) {
         console.error(`[TBA] HTTP ${response.status} ${response.statusText} for ${param}`);
         throw new Error(`TBA API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      return data;
   } catch (error) {
      console.error(`[TBA] Fetch failed for ${param}:`, error);
      handleError(error);
      return undefined; // Explicitly return undefined on error
   }
}

export { fetchTBAData };
