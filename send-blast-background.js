// ===========================================================================
//  send-blast-background.js  —  Netlify background function
//
//  Background functions (the "-background" suffix) return 202 immediately and
//  may run up to 15 minutes, which suits bulk sending. The browser fires this
//  after it has written the campaign + recipients to Supabase.
//
//  Auth: the caller passes the signed-in user's JWT. We verify it, then use
//  the service-role key (server-only) to read credentials and write results.
// ===========================================================================
const { createClient } = require("@supabase/supabase-js");
const nodemailer = require("nodemailer");
const sgMail = require("@sendgrid/mail");
const crypto = require("crypto");

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;
const UNSUB_SECRET = process.env.UNSUBSCRIBE_SECRET || "change-me";
const SITE_URL     = process.env.URL || process.env.DEPLOY_URL || "";

const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

// fill {{token}} placeholders from a recipient's merge_data
function render(str, data) {
  return String(str || "").replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, k) =>
    (data && data[k] != null) ? String(data[k]) : "");
}
function unsubLink(userId, email) {
  const sig = crypto.createHmac("sha256", UNSUB_SECRET)
    .update(userId + ":" + email).digest("hex").slice(0, 24);
  const q = new URLSearchParams({ u: userId, e: email, s: sig }).toString();
  return `${SITE_URL}/.netlify/functions/unsubscribe?${q}`;
}
function withFooter(html, link) {
  return `${html}
    <hr style="border:none;border-top:1px solid #e6e5e6;margin:28px 0 14px">
    <p style="font-size:12px;color:#909090;line-height:1.5">
      You received this email from a verified sender.
      <a href="${link}" style="color:#717171">Unsubscribe</a> to stop receiving these messages.
    </p>`;
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return { statusCode: 405, body: "Method not allowed" };

  // --- verify caller -------------------------------------------------------
  const token = (event.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!token) return { statusCode: 401, body: "Missing auth token" };
  const { data: userData, error: userErr } = await admin.auth.getUser(token);
  if (userErr || !userData?.user) return { statusCode: 401, body: "Invalid auth token" };
  const userId = userData.user.id;

  let campaignId;
  try { campaignId = JSON.parse(event.body || "{}").campaign_id; }
  catch { return { statusCode: 400, body: "Bad JSON" }; }
  if (!campaignId) return { statusCode: 400, body: "campaign_id required" };

  // --- load campaign (scoped to this user) --------------------------------
  const { data: campaign } = await admin.from("campaigns")
    .select("*").eq("id", campaignId).eq("user_id", userId).single();
  if (!campaign) return { statusCode: 404, body: "Campaign not found" };

  const { data: account } = await admin.from("sending_accounts")
    .select("*").eq("id", campaign.account_id).eq("user_id", userId).single();
  if (!account) {
    await admin.from("campaigns").update({ status: "failed" }).eq("id", campaignId);
    return { statusCode: 400, body: "Sending account not found" };
  }

  // suppression list
  const { data: unsubs } = await admin.from("unsubscribes").select("email").eq("user_id", userId);
  const blocked = new Set((unsubs || []).map((u) => u.email.toLowerCase()));

  // --- build transport -----------------------------------------------------
  let transport = null;
  if (account.type === "smtp") {
    const c = account.config || {};
    transport = nodemailer.createTransport({
      host: c.host, port: Number(c.port) || 587, secure: !!c.secure,
      auth: { user: c.username, pass: c.password },
    });
  } else if (account.type === "sendgrid") {
    sgMail.setApiKey(account.config?.apiKey);
  }
  const from = account.from_name ? `${account.from_name} <${account.from_email}>` : account.from_email;

  await admin.from("campaigns").update({ status: "sending" }).eq("id", campaignId);

  // --- send pending recipients in batches ----------------------------------
  let sent = campaign.sent || 0, failed = campaign.failed || 0;
  const PAGE = 100;
  while (true) {
    const { data: batch } = await admin.from("recipients")
      .select("id,email,merge_data").eq("campaign_id", campaignId)
      .eq("status", "pending").limit(PAGE);
    if (!batch || batch.length === 0) break;

    for (const r of batch) {
      const to = String(r.email).trim();
      if (blocked.has(to.toLowerCase())) {
        await admin.from("recipients").update({ status: "skipped", error: "unsubscribed" }).eq("id", r.id);
        continue;
      }
      const subject = render(campaign.subject, r.merge_data);
      const bodyHtml = withFooter(render(campaign.body_html, r.merge_data), unsubLink(userId, to));
      const headers = { "List-Unsubscribe": `<${unsubLink(userId, to)}>` };
      try {
        if (account.type === "smtp") {
          await transport.sendMail({ from, to, subject, html: bodyHtml, headers });
        } else {
          await sgMail.send({ from: account.from_email, to, subject, html: bodyHtml, headers });
        }
        sent++;
        await admin.from("recipients").update({ status: "sent", sent_at: new Date().toISOString() }).eq("id", r.id);
      } catch (e) {
        failed++;
        await admin.from("recipients").update({ status: "failed", error: String(e.message || e).slice(0, 300) }).eq("id", r.id);
      }
    }
    await admin.from("campaigns").update({ sent, failed }).eq("id", campaignId);
  }

  const finalStatus = failed > 0 ? "failed" : "done";
  await admin.from("campaigns").update({ status: finalStatus, sent, failed }).eq("id", campaignId);
  return { statusCode: 200, body: JSON.stringify({ sent, failed, status: finalStatus }) };
};
