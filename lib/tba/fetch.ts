import { handleError } from "../../utils/errorHandler";
type fetchMethod = "POST" | "GET" | "OPTIONS";

const tbaAuthKey = import.meta.env.VITE_X_TBA_AUTH_KEY;

async function fetchTBAData(param: string, method: fetchMethod) {
   const url = `https://www.thebluealliance.com/api/v3${param}`;
   try {
      const response = await fetch(url, {
         method: method,
         headers: {
            "X-TBA-Auth-Key": tbaAuthKey,
         },
      });
      if (!response.ok) {
         throw new Error(`An error occured: ${response.status}`);
      }

      const data = await response.json();
      return data;
   } catch (error) {
      handleError(error);
   }
}

export { fetchTBAData };
