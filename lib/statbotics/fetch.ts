import { handleError } from "../../utils/errorHandler";

async function fetchStatboticsData(param: string) {
   const url = `https://api.statbotics.io/v3${param}`;
   try {
      const response = await fetch(url, {
         method: "GET",
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

export { fetchStatboticsData };
