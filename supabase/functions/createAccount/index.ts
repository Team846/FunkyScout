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
    const { email, password, username } = await req.json();

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

    // Get the origin from the request to support both localhost and production
    const origin = req.headers.get("origin") || Deno.env.get("AUTH_CALLBACK_URL");
    const baseUrl = origin || "https://funkyscout.vercel.app";
    // Redirect to /verify for email confirmation (matches Supabase redirect URLs)
    const callbackUrl = `${baseUrl}/verify`;

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
