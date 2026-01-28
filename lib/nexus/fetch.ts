import { handleError } from "../../utils/errorHandler";

type fetchMethod = "POST" | "GET" | "OPTIONS";

const nexusApiKey = import.meta.env.VITE_NEXUS_API_KEY;

async function fetchNexusData(param: string, method: fetchMethod) {
   const url = `https://frc.nexus/api/v1${param}`;
   try {
      const response = await fetch(url, {
         method: method,
         headers: {
            "Nexus-Api-Key": nexusApiKey,
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

export { fetchNexusData };
