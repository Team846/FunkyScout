import { createClient } from "jsr:@supabase/supabase-js@2";

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
    const { email, password, username, redirectTo: bodyRedirectTo } = await req.json();

    console.log(`Creating account ${email}/${username}`);

    // Use anon key for signup so Supabase sends the confirmation email.
    // Service role bypasses email confirmation (auto-confirms without emailing).
    const supabaseAuth = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
    );

    // Use service role for admin operations (profile update bypasses RLS)
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Resolve the callback URL. Priority:
    //   1. redirectTo from request body (client explicitly passes VITE_REDIRECT_URL/verify)
    //   2. AUTH_CALLBACK_URL env var on the edge function
    //   3. origin request header (works for same-machine / LAN dev access)
    //   4. hardcoded fallback (production Vercel URL)
    const callbackUrl = bodyRedirectTo
      || Deno.env.get("AUTH_CALLBACK_URL")
      || (() => {
        const origin = req.headers.get("origin");
        return origin ? `${origin}/verify` : "https://funkyscout.vercel.app/verify";
      })();

    console.log(`Using callback URL: ${callbackUrl}`);

    // 1. sign up the user (anon key so confirmation email is sent)
    const { data, error: signUpError } = await supabaseAuth.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: callbackUrl,
      },
    });

    if (signUpError) {
      console.log("Signup Error: " + signUpError.message);
      return new Response(
        JSON.stringify({ error: signUpError.message }),
        {
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
          },
          status: 400,
        },
      );
    }

    const uid = data?.user?.id;

    if (!uid) {
      console.log("Could not get UUID");
      return new Response(
        JSON.stringify({ error: "Could not find your UUID" }),
        {
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
          },
          status: 400,
        },
      );
    }

    console.log(`Using UUID ${uid}`);

    // 2. add the user to the user_profiles table (service role to bypass RLS)
    const { error: profileError } = await supabaseAdmin
      .from("user_profiles")
      .update({ name: username })
      .eq("uid", uid)
      .select();

    if (profileError) {
      console.log("Username Assignment Error: " + profileError.message);
      return new Response(
        JSON.stringify({ error: profileError.message }),
        {
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
          },
          status: 400,
        },
      );
    }

    // 3. respond
    return new Response(
      JSON.stringify({
        message: "User created and profile inserted successfully.",
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
