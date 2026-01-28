import { createClient } from "jsr:@supabase/supabase-js@2";
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
   "Access-Control-Allow-Origin": "*",
   "Access-Control-Allow-Methods": "POST, OPTIONS",
   "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
   if (req.method == "OPTIONS") {
      return new Response("ok", { status: 200, headers: corsHeaders });
   }

   try {
      const { userID, name } = await req.json();

      const supabase = createClient(
         Deno.env.get("SUPABASE_URL")!,
         Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      );

      const authHeader = req.headers.get("Authorization")!;
      const token = authHeader.replace("Bearer ", "");
      const { data } = await supabase.auth.getUser(token);

      // If the user is an admin, allow the modified user
      // to be any user, but if they aren't an admin, simply
      // modify the user accessing the edge function.
      let targetUserID = data!.user!.id;

      const { data: user_profiles } = await supabase
         .from("user_profiles")
         .select("*")
         .eq("uid", targetUserID);

      if (user_profiles![0].role == "admin") {
         targetUserID = userID;
      }

      const { error } = await supabase
         .from("user_profiles")
         .update({ name: name })
         .eq("uid", targetUserID)
         .select();

      if (error) {
         throw new Error("Error updating user profile");
      }

      return new Response(
         JSON.stringify({
            message: "Successfully changed your name",
         }),
         {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
            status: 200,
         },
      );
   } catch (error) {
      return new Response(JSON.stringify({ error: error.message }), {
         headers: { ...corsHeaders, "Content-Type": "application/json" },
         status: 500,
      });
   }
});
