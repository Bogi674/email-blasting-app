// ===========================================================================
//  unsubscribe.js  —  public endpoint linked from every email footer.
//  Verifies the HMAC signature, then records the address on the user's
//  suppression list so future blasts skip it.
// ===========================================================================
const { createClient } = require("@supabase/supabase-js");
const crypto = require("crypto");

const admin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);
const SECRET = process.env.UNSUBSCRIBE_SECRET || "change-me";

function page(msg) {
  return `<!DOCTYPE html><meta charset="utf-8">
  <title>Unsubscribe</title>
  <div style="font-family:Inter,system-ui,sans-serif;max-width:440px;margin:14vh auto;text-align:center;color:#252525">
    <div style="width:46px;height:46px;border-radius:12px;background:#142043;margin:0 auto 18px;
      display:flex;align-items:center;justify-content:center;color:#fff;font-size:22px">✓</div>
    <h1 style="font-size:20px;color:#142043;margin-bottom:8px">${msg.title}</h1>
    <p style="color:#717171;line-height:1.6">${msg.body}</p>
  </div>`;
}

exports.handler = async (event) => {
  const { u: userId, e: email, s: sig } = event.queryStringParameters || {};
  if (!userId || !email || !sig) {
    return { statusCode: 400, headers: { "Content-Type": "text/html" },
      body: page({ title: "Invalid link", body: "This unsubscribe link is incomplete." }) };
  }
  const expected = crypto.createHmac("sha256", SECRET).update(userId + ":" + email).digest("hex").slice(0, 24);
  if (sig !== expected) {
    return { statusCode: 403, headers: { "Content-Type": "text/html" },
      body: page({ title: "Invalid link", body: "This unsubscribe link could not be verified." }) };
  }
  await admin.from("unsubscribes").upsert(
    { user_id: userId, email: email.toLowerCase() },
    { onConflict: "user_id,email" }
  );
  return { statusCode: 200, headers: { "Content-Type": "text/html" },
    body: page({ title: "You're unsubscribed", body: `${email} won't receive further emails from this sender.` }) };
};
