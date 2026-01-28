import { createClient } from "jsr:@supabase/supabase-js@2";

//This function allows users to promote themselves with a promotion code

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
      const { userID, inviteCode }: { userID: string; inviteCode: string } =
         await req.json();

      console.log(`Invoked promotion with ${inviteCode}`);

      const supabase = createClient(
         Deno.env.get("SUPABASE_URL")!,
         Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      );

      console.log("Fetching codes");

      const { data: invite_codes, error } = await supabase
         .from("invite_codes")
         .select("*")
         .eq("code", inviteCode);

      if (error) {
         throw new Error("Error fetching codes");
      }

      if (invite_codes.length == 0) {
         throw new Error("This code is invalid");
      }

      console.log("Fetching current role");

      const { data: user_profiles, error: selectError } = await supabase
         .from("user_profiles")
         .select("*")
         .eq("uid", userID);

      if (selectError) {
         throw new Error("Error fetching user data");
      }

      const expiration = new Date(invite_codes[0].expiry);
      const now = new Date();

      if (expiration < now) {
         throw new Error("This code is expired");
      }

      const currentPosition = user_profiles[0].role;
      const promotion = invite_codes[0].type;

      if (currentPosition == "admin" && promotion == "promote.scouter") {
         throw new Error("You already have this role");
      }

      console.log(
         `Using code ${inviteCode} to promote ${
            userID.substring(0, 5)
         }... using ${promotion}`,
      );

      if (promotion) {
         const { error: updateError } = await supabase
            .from("user_profiles")
            .update({
               role: promotion == "promote.scouter"
                  ? "scouter"
                  : promotion == "promote.admin"
                  ? "admin"
                  : currentPosition,
            })
            .eq("uid", userID)
            .select();

         if (updateError) {
            throw new Error("Error updating user role");
         }
      } else {
         throw new Error("Invalid code");
      }

      // Respond with success
      return new Response(
         JSON.stringify({
            message: "Successfully updated your role",
         }),
         {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
            status: 200,
         },
      );
   } catch (error) {
      return new Response(JSON.stringify({ error: error.message }), {
         headers: { ...corsHeaders, "Content-Type": "application/json" },
         status: 400,
      });
   }
});
