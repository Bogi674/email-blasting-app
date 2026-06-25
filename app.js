/* ==========================================================================
   Email Blast Console — client app
   Pure vanilla JS. Talks to Supabase (auth + DB) and a Netlify function
   (/.netlify/functions/send-blast-background) for actual sending.
   ========================================================================== */
(() => {
  "use strict";

  const cfg = window.APP_CONFIG || {};
  if (!cfg.SUPABASE_URL || cfg.SUPABASE_URL.includes("YOUR-PROJECT")) {
    document.getElementById("authErr").textContent =
      "config.js is not filled in. Add your Supabase URL and anon key, then reload.";
    document.getElementById("authErr").classList.remove("hide");
  }
  const sb = window.supabase.createClient(
    cfg.SUPABASE_URL || "https://placeholder.supabase.co",
    cfg.SUPABASE_ANON_KEY || "placeholder"
  );

  // ---- tiny helpers ----------------------------------------------------
  const $  = (s, r = document) => r.querySelector(s);
  const el = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
  const fmt = (n) => Number(n || 0).toLocaleString("en-US");
  const nowStr = () => {
    const d = new Date();
    const days=["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
    const mon=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    const p=(x)=>String(x).padStart(2,"0");
    return `${days[d.getDay()]}, ${p(d.getDate())} ${mon[d.getMonth()]} ${d.getFullYear()} · ${p(d.getHours())}:${p(d.getMinutes())}`;
  };
  function toast(msg, bad=false){
    const t=el("toast"); t.textContent=msg; t.className="show"+(bad?" bad":"");
    clearTimeout(toast._t); toast._t=setTimeout(()=>t.className="",2600);
  }
  const ICON = {
    dashboard:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/></svg>',
    templates:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="13" y2="17"/></svg>',
    accounts:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>',
  };

  // ---- app state -------------------------------------------------------
  const state = {
    user:null, screen:"dashboard",
    accounts:[], templates:[], campaigns:[],
    wiz:null, // when running the new-blast wizard
  };

  // =====================================================================
  //  AUTH
  // =====================================================================
  let authMode = "signin";
  function renderAuthMode(){
    el("authTitle").textContent = authMode==="signin" ? "Sign in" : "Create account";
    el("authBtn").textContent   = authMode==="signin" ? "Sign in" : "Create account";
    el("authSwap").innerHTML = authMode==="signin"
      ? 'No account yet? <b>Create one</b>'
      : 'Already have an account? <b>Sign in</b>';
    el("password").autocomplete = authMode==="signin" ? "current-password":"new-password";
  }
  el("authSwap").addEventListener("click",(e)=>{
    if(e.target.tagName==="B"){ authMode=authMode==="signin"?"signup":"signin"; el("authErr").classList.add("hide"); renderAuthMode(); }
  });
  el("authBtn").addEventListener("click", doAuth);
  el("password").addEventListener("keydown",(e)=>{ if(e.key==="Enter") doAuth(); });
  async function doAuth(){
    const email=el("email").value.trim(), password=el("password").value;
    const errBox=el("authErr"); errBox.classList.add("hide");
    if(!email||!password){ errBox.textContent="Enter your email and password."; errBox.classList.remove("hide"); return; }
    const btn=el("authBtn"); btn.disabled=true; const orig=btn.textContent;
    btn.innerHTML='<span class="spin"></span>';
    try{
      let res;
      if(authMode==="signin") res=await sb.auth.signInWithPassword({email,password});
      else res=await sb.auth.signUp({email,password});
      if(res.error) throw res.error;
      if(authMode==="signup" && !res.data.session){
        errBox.className="err"; errBox.style.background="var(--green-bg)";
        errBox.style.borderColor="var(--green-bd)"; errBox.style.color="#1b6e30";
        errBox.textContent="Account created. Check your inbox to confirm, then sign in.";
        authMode="signin"; renderAuthMode();
      }
    }catch(err){
      errBox.textContent=err.message||"Authentication failed."; errBox.classList.remove("hide");
    }finally{ btn.disabled=false; btn.textContent=orig; }
  }
  el("signout").addEventListener("click", async()=>{ await sb.auth.signOut(); });

  let entered=false;
  sb.auth.onAuthStateChange(async (_e, session)=>{
    if(session?.user){
      state.user=session.user;
      if(!entered){ entered=true; await enterApp(); } // ignore token refreshes
    } else {
      entered=false; state.user=null;
      el("shell").classList.add("hide"); el("auth").classList.remove("hide");
    }
  });

  async function enterApp(){
    el("auth").classList.add("hide"); el("shell").classList.remove("hide");
    el("who").textContent=state.user.email;
    el("now").textContent=nowStr();
    buildNav();
    await loadAll();
    go(state.screen);
  }

  // =====================================================================
  //  DATA
  // =====================================================================
  async function loadAll(){
    const uid=state.user.id;
    const [a,t,c]=await Promise.all([
      sb.from("sending_accounts").select("*").order("created_at"),
      sb.from("templates").select("*").order("updated_at",{ascending:false}),
      sb.from("campaigns").select("*").order("created_at",{ascending:false}),
    ]);
    state.accounts=a.data||[]; state.templates=t.data||[]; state.campaigns=c.data||[];
  }

  // =====================================================================
  //  NAV / ROUTER
  // =====================================================================
  const NAV=[
    {id:"dashboard",label:"Dashboard",icon:"dashboard"},
    {id:"templates",label:"Templates",icon:"templates"},
    {id:"accounts", label:"Connected Accounts",icon:"accounts"},
  ];
  const TITLES={dashboard:"Dashboard",templates:"Email Templates",accounts:"Connected Accounts",wizard:"New Blast"};
  function buildNav(){
    el("nav").innerHTML=NAV.map(n=>
      `<button data-go="${n.id}">${ICON[n.icon]}<span>${n.label}</span></button>`).join("");
    el("nav").querySelectorAll("button").forEach(b=>b.addEventListener("click",()=>go(b.dataset.go)));
  }
  function go(screen){
    state.screen=screen; state.wiz = screen==="wizard"?state.wiz:null;
    el("pageTitle").textContent=TITLES[screen]||"";
    const active = screen==="wizard" ? "" : screen;
    el("nav").querySelectorAll("button").forEach(b=>b.classList.toggle("on",b.dataset.go===active));
    el("view").scrollTop=0;
    ({dashboard:viewDashboard,templates:viewTemplates,accounts:viewAccounts,wizard:viewWizard}[screen]||viewDashboard)();
  }

  // =====================================================================
  //  DASHBOARD
  // =====================================================================
  const PILL={
    sending:{bg:"var(--info-bg)",bd:"var(--info-bd)",c:"var(--info)",fill:"#4994EC"},
    done:   {bg:"var(--green-bg)",bd:"var(--green-bd)",c:"var(--green)",fill:"#4EC558"},
    queued: {bg:"var(--amber-bg)",bd:"var(--amber-bd)",c:"var(--amber)",fill:"#ACBFD4"},
    failed: {bg:"var(--red-bg)",bd:"var(--red-bd)",c:"var(--red)",fill:"#FF4040"},
    draft:  {bg:"var(--navy-tint)",bd:"var(--navy-bd)",c:"var(--navy)",fill:"#D5D5D5"},
  };
  const STATUS_LABEL={sending:"Sending",done:"Completed",queued:"Queued",failed:"Finished w/ errors",draft:"Draft"};

  function viewDashboard(){
    const c=state.campaigns;
    const sent30=c.reduce((s,x)=>s+(x.sent||0),0);
    const sendingNow=c.filter(x=>x.status==="sending"||x.status==="queued").length;
    const scheduled=c.filter(x=>x.scheduled_at && x.status!=="done").length;
    const failed=c.reduce((s,x)=>s+(x.failed||0),0);
    const stat=(v,l,ic,tint,col)=>`<div class="stat"><div class="ic" style="background:${tint}">${ic.replace("currentColor",col)}</div><div class="v">${v}</div><div class="l">${l}</div></div>`;
    const i=(p)=>`<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;

    const rows = c.length ? c.map(x=>{
      const p=PILL[x.status]||PILL.draft;
      const pct = x.total? Math.round((x.sent/x.total)*100):0;
      return `<tr>
        <td><div class="cname">${esc(x.name)}</div><div class="csub">${esc(acctName(x.account_id))}</div></td>
        <td><span class="pill" style="background:${p.bg};border-color:${p.bd};color:${p.c}">${STATUS_LABEL[x.status]||x.status}</span></td>
        <td style="min-width:170px">
          <div class="bar"><i style="width:${pct}%;background:${p.fill}"></i></div>
          <div class="csub">${fmt(x.sent)} / ${fmt(x.total)}${x.failed?` · <span style="color:var(--red)">${x.failed} failed</span>`:""}</div>
        </td>
        <td class="muted" style="white-space:nowrap">${when(x)}</td>
        <td style="text-align:right">${x.status==="draft"
            ? `<button class="btn btn-ghost btn-sm" data-resume="${x.id}">Open draft</button>`
            : (x.failed>0?`<button class="btn btn-ghost btn-sm" data-retry="${x.id}">Retry failed</button>`:`<button class="x" data-del="${x.id}" title="Delete">${i('<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>')}</button>`)}</td>
      </tr>`;
    }).join("") : "";

    el("view").innerHTML=`
      <div class="spread" style="margin-bottom:18px">
        <p class="muted">Overview of your sending activity.</p>
        <button class="btn btn-primary btn-sm" id="newBlast" style="width:auto">＋ New blast</button>
      </div>
      <div class="row" style="margin-bottom:18px">
        ${stat(fmt(sent30),"Emails sent", i('<line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>'),"var(--navy-tint)","var(--navy)")}
        ${stat(sendingNow,"Sending / queued", i('<polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>'),"var(--info-bg)","var(--info)")}
        ${stat(scheduled,"Scheduled", i('<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>'),"var(--amber-bg)","var(--amber)")}
        ${stat(fmt(failed),"Failed · needs retry", i('<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>'),"var(--red-bg)","var(--red)")}
      </div>
      <div class="panel">
        <div class="ph"><h3>Campaigns</h3></div>
        ${c.length?`<table><thead><tr><th>Campaign</th><th>Status</th><th>Progress</th><th>When</th><th></th></tr></thead><tbody>${rows}</tbody></table>`
          :`<div class="empty"><b>No campaigns yet</b>Create your first blast to see it here.<br><br><button class="btn btn-primary btn-sm" id="newBlast2" style="width:auto;margin:0 auto">＋ New blast</button></div>`}
      </div>`;

    el("newBlast")?.addEventListener("click",startWizard);
    el("newBlast2")?.addEventListener("click",startWizard);
    $("#view").querySelectorAll("[data-del]").forEach(b=>b.addEventListener("click",()=>delCampaign(b.dataset.del)));
    $("#view").querySelectorAll("[data-retry]").forEach(b=>b.addEventListener("click",()=>triggerSend(b.dataset.retry,true)));
    $("#view").querySelectorAll("[data-resume]").forEach(b=>b.addEventListener("click",()=>resumeDraft(b.dataset.resume)));
  }
  function acctName(id){ const a=state.accounts.find(x=>x.id===id); return a?`${a.from_email} · ${a.type==="sendgrid"?"SendGrid":"SMTP"}`:"—"; }
  function when(x){
    const d=new Date(x.updated_at||x.created_at);
    if(x.scheduled_at && x.status!=="done") return "Scheduled "+new Date(x.scheduled_at).toLocaleString();
    return (x.status==="draft"?"Saved ":"")+d.toLocaleString();
  }
  async function delCampaign(id){
    if(!confirm("Delete this campaign and its recipients?")) return;
    await sb.from("campaigns").delete().eq("id",id);
    await loadAll(); go("dashboard"); toast("Campaign deleted");
  }

  // =====================================================================
  //  TEMPLATES
  // =====================================================================
  function viewTemplates(){
    const t=state.templates;
    el("view").innerHTML=`
      <div class="spread" style="margin-bottom:18px">
        <p class="muted">Reusable subject + body with <span class="chip" style="cursor:default">{{merge}}</span> variables.</p>
        <button class="btn btn-primary btn-sm" id="newTpl" style="width:auto">＋ New template</button>
      </div>
      ${t.length?`<div class="grid">${t.map(x=>`
        <div class="tcard">
          <h4>${esc(x.name)}</h4>
          <div class="meta">${esc(x.subject||"No subject")}<br>${countVars(x.body_html)} merge vars · edited ${new Date(x.updated_at).toLocaleDateString()}</div>
          <div class="acts">
            <button class="btn btn-ghost btn-sm" data-edit="${x.id}">Edit</button>
            <button class="btn btn-ghost btn-sm" data-use="${x.id}">Use in blast</button>
            <button class="x" data-delt="${x.id}" title="Delete" style="margin-left:auto">✕</button>
          </div>
        </div>`).join("")}</div>`
        :`<div class="panel"><div class="empty"><b>No templates yet</b>Save a reusable subject and body to speed up future blasts.</div></div>`}`;
    el("newTpl").addEventListener("click",()=>editTemplate(null));
    $("#view").querySelectorAll("[data-edit]").forEach(b=>b.addEventListener("click",()=>editTemplate(b.dataset.edit)));
    $("#view").querySelectorAll("[data-delt]").forEach(b=>b.addEventListener("click",()=>delTemplate(b.dataset.delt)));
    $("#view").querySelectorAll("[data-use]").forEach(b=>b.addEventListener("click",()=>{ const tpl=state.templates.find(z=>z.id===b.dataset.use); startWizard(tpl); }));
  }
  const countVars=(h)=>{ const m=String(h||"").match(/\{\{[^}]+\}\}/g); return m?new Set(m).size:0; };

  function editTemplate(id){
    const t=id?state.templates.find(x=>x.id===id):{name:"",subject:"",body_html:""};
    openModal({
      title:id?"Edit template":"New template",
      body:`
        <div class="field"><label class="fl">Template name</label><input id="t_name" class="fld" value="${esc(t.name)}" placeholder="Payment Reminder"></div>
        <div class="field"><label class="fl">Subject</label><input id="t_subj" class="fld" value="${esc(t.subject)}" placeholder="Pengingat jatuh tempo angsuran"></div>
        <div class="field"><label class="fl">Body (HTML supported)</label>
          <textarea id="t_body" class="fld" rows="9" placeholder="Halo {{nama_lengkap}}, ...">${esc(t.body_html)}</textarea>
          <div class="muted" style="font-size:12px;margin-top:8px">Insert merge variables like <b>{{nama_lengkap}}</b>. They are filled per recipient from your CSV.</div>
        </div>`,
      okLabel:id?"Save changes":"Create template",
      onOk:async()=>{
        const name=el("t_name").value.trim();
        if(!name){ toast("Give the template a name",true); return false; }
        const payload={name,subject:el("t_subj").value,body_html:el("t_body").value,user_id:state.user.id};
        const res=id ? await sb.from("templates").update(payload).eq("id",id)
                     : await sb.from("templates").insert(payload);
        if(res.error){ toast(res.error.message,true); return false; }
        await loadAll(); viewTemplates(); toast(id?"Template saved":"Template created");
      }
    });
  }
  async function delTemplate(id){
    if(!confirm("Delete this template?")) return;
    await sb.from("templates").delete().eq("id",id);
    await loadAll(); viewTemplates(); toast("Template deleted");
  }

  // =====================================================================
  //  CONNECTED ACCOUNTS
  // =====================================================================
  function viewAccounts(){
    const a=state.accounts;
    el("view").innerHTML=`
      <div class="spread" style="margin-bottom:18px">
        <p class="muted">Connect the mailboxes you send from. Credentials are stored against your account only.</p>
        <button class="btn btn-primary btn-sm" id="addAcct" style="width:auto">＋ Connect account</button>
      </div>
      ${a.length?`<div class="grid">${a.map(x=>{
        const ok=x.status==="connected";
        const p=ok?{bg:"var(--green-bg)",bd:"var(--green-bd)",c:"var(--green)"}:{bg:"var(--red-bg)",bd:"var(--red-bd)",c:"var(--red)"};
        const badge = x.type==="sendgrid"?{t:"SendGrid API",bg:"var(--amber-bg)",c:"var(--amber)"}:{t:"SMTP",bg:"var(--info-bg)",c:"var(--info)"};
        return `<div class="tcard">
          <div class="spread"><h4>${esc(x.name)}</h4>${x.is_default?'<span class="chip" style="cursor:default">Default</span>':""}</div>
          <div class="meta">${esc(x.from_email)}<br><span style="display:inline-block;font-weight:600;font-size:11px;padding:2px 7px;border-radius:5px;background:${badge.bg};color:${badge.c}">${badge.t}</span> ${esc(protoLine(x))}</div>
          <div class="acts">
            <span class="pill" style="background:${p.bg};border-color:${p.bd};color:${p.c}">${ok?"Connected":"Needs attention"}</span>
            ${x.is_default?"":`<button class="btn btn-ghost btn-sm" data-def="${x.id}">Make default</button>`}
            <button class="x" data-dela="${x.id}" title="Remove" style="margin-left:auto">✕</button>
          </div>
        </div>`;}).join("")}</div>`
        :`<div class="panel"><div class="empty"><b>No sending accounts</b>Connect an SMTP mailbox or a SendGrid API key to start sending.</div></div>`}`;
    el("addAcct").addEventListener("click",addAccount);
    $("#view").querySelectorAll("[data-dela]").forEach(b=>b.addEventListener("click",()=>delAccount(b.dataset.dela)));
    $("#view").querySelectorAll("[data-def]").forEach(b=>b.addEventListener("click",()=>makeDefault(b.dataset.def)));
  }
  function protoLine(x){
    if(x.type==="sendgrid") return "· API key ••••"+String(x.config?.apiKey||"").slice(-4);
    return `· ${esc(x.config?.host||"")}:${x.config?.port||""} ${x.config?.secure?"· SSL/TLS":"· STARTTLS"}`;
  }
  function addAccount(){
    let type="smtp";
    const smtpFields=`
      <div class="field"><label class="fl">Display name</label><input id="a_name" class="fld" placeholder="Transactional SMTP"></div>
      <div class="grid2">
        <div class="field"><label class="fl">From email</label><input id="a_from" class="fld" placeholder="noreply@company.com"></div>
        <div class="field"><label class="fl">From name (optional)</label><input id="a_fname" class="fld" placeholder="Company"></div>
      </div>
      <div class="grid2">
        <div class="field"><label class="fl">SMTP host</label><input id="a_host" class="fld" placeholder="smtp.company.com"></div>
        <div class="field"><label class="fl">Port</label><input id="a_port" class="fld" value="587"></div>
      </div>
      <div class="grid2">
        <div class="field"><label class="fl">Username</label><input id="a_user" class="fld" placeholder="noreply@company.com"></div>
        <div class="field"><label class="fl">Password</label><input id="a_pass" class="fld" type="password" placeholder="••••••••"></div>
      </div>
      <label style="display:flex;gap:8px;align-items:center;font-size:13px;color:var(--ink)"><input id="a_secure" type="checkbox"> Use SSL/TLS (port 465). Leave off for STARTTLS (587).</label>`;
    const sgFields=`
      <div class="field"><label class="fl">Display name</label><input id="a_name" class="fld" placeholder="Marketing — SendGrid"></div>
      <div class="grid2">
        <div class="field"><label class="fl">From email (verified sender)</label><input id="a_from" class="fld" placeholder="product@company.com"></div>
        <div class="field"><label class="fl">From name (optional)</label><input id="a_fname" class="fld" placeholder="Company"></div>
      </div>
      <div class="field"><label class="fl">SendGrid API key</label><input id="a_key" class="fld" type="password" placeholder="SG.xxxxxxxx"></div>`;
    openModal({
      title:"Connect a sending account",
      body:`
        <div class="row" style="margin-bottom:16px;gap:8px">
          <button class="btn btn-sm" id="tab_smtp" style="background:var(--navy);color:#fff">SMTP / IMAP</button>
          <button class="btn btn-sm btn-ghost" id="tab_sg">SendGrid API</button>
        </div>
        <div id="acctFields">${smtpFields}</div>`,
      okLabel:"Connect account",
      onOk:async()=>{
        const base={name:val("a_name"),from_email:val("a_from"),from_name:val("a_fname"),user_id:state.user.id,type,is_default:state.accounts.length===0,status:"connected"};
        if(!base.name||!base.from_email){ toast("Name and from email are required",true); return false; }
        if(type==="smtp"){
          base.config={host:val("a_host"),port:Number(val("a_port")||587),secure:el("a_secure").checked,username:val("a_user"),password:val("a_pass")};
          if(!base.config.host||!base.config.username||!base.config.password){ toast("SMTP host, username and password are required",true); return false; }
        }else{
          base.config={apiKey:val("a_key")};
          if(!base.config.apiKey){ toast("SendGrid API key is required",true); return false; }
        }
        const res=await sb.from("sending_accounts").insert(base);
        if(res.error){ toast(res.error.message,true); return false; }
        await loadAll(); viewAccounts(); toast("Account connected");
      },
      after:()=>{
        const swap=(t)=>{ type=t;
          el("tab_smtp").style.background=t==="smtp"?"var(--navy)":"#fff";
          el("tab_smtp").style.color=t==="smtp"?"#fff":"var(--navy)";
          el("tab_smtp").classList.toggle("btn-ghost",t!=="smtp");
          el("tab_sg").style.background=t==="sendgrid"?"var(--navy)":"#fff";
          el("tab_sg").style.color=t==="sendgrid"?"#fff":"var(--navy)";
          el("tab_sg").classList.toggle("btn-ghost",t!=="sendgrid");
          el("acctFields").innerHTML = t==="smtp"?smtpFields:sgFields;
        };
        el("tab_smtp").addEventListener("click",()=>swap("smtp"));
        el("tab_sg").addEventListener("click",()=>swap("sendgrid"));
      }
    });
  }
  const val=(id)=> (el(id)?.value||"").trim();
  async function delAccount(id){
    if(!confirm("Remove this sending account?")) return;
    await sb.from("sending_accounts").delete().eq("id",id);
    await loadAll(); viewAccounts(); toast("Account removed");
  }
  async function makeDefault(id){
    await sb.from("sending_accounts").update({is_default:false}).eq("user_id",state.user.id);
    await sb.from("sending_accounts").update({is_default:true}).eq("id",id);
    await loadAll(); viewAccounts(); toast("Default account updated");
  }

  // =====================================================================
  //  NEW BLAST WIZARD
  // =====================================================================
  const STEPS=[["Campaign"],["Compose"],["Recipients"],["Verify"],["Send"]];
  function startWizard(preTpl){
    state.wiz={
      step:1,
      name:"", account_id:state.accounts.find(a=>a.is_default)?.id || state.accounts[0]?.id || "",
      subject:preTpl?.subject||"", body:preTpl?.body_html||"", template_id:preTpl?.id||"",
      recipients:[], columns:[], emailCol:"", mapping:{}, campaignId:null,
    };
    go("wizard");
  }
  async function resumeDraft(id){
    const c=state.campaigns.find(x=>x.id===id);
    const r=await sb.from("recipients").select("email,merge_data").eq("campaign_id",id);
    state.wiz={ step:1,name:c.name,account_id:c.account_id||"",subject:c.subject,body:c.body_html,template_id:c.template_id||"",
      recipients:(r.data||[]).map(x=>({email:x.email,...x.merge_data})),
      columns:[], emailCol:"email", mapping:{}, campaignId:id };
    go("wizard");
  }

  function viewWizard(){
    const w=state.wiz;
    const stepsHtml=STEPS.map((s,i)=>{
      const n=i+1, cls=n<w.step?"done":n===w.step?"cur":"";
      return `<div class="step ${cls}"><div class="c">${n<w.step?"✓":n}</div><span class="sl">${s[0]}</span>${i<4?'<span class="ln"></span>':""}</div>`;
    }).join("");
    el("view").innerHTML=`
      <div class="steps">${stepsHtml}</div>
      <div class="wizbody" id="wizbody"></div>
      <div class="wbar">
        <button class="btn btn-ghost" id="wBack">${w.step<=1?"Cancel":"Back"}</button>
        <button class="btn ${w.step>=5?"btn-green":"btn-primary"}" id="wNext" style="width:auto">${w.step>=5?"Send blast":"Continue"}</button>
      </div>`;
    ({1:wizCampaign,2:wizCompose,3:wizRecipients,4:wizVerify,5:wizSend}[w.step])();
    el("wBack").addEventListener("click",()=> w.step<=1?go("dashboard"):(w.step--,viewWizard()));
    el("wNext").addEventListener("click",wizNext);
  }
  function wizCampaign(){
    const w=state.wiz;
    const opts=state.accounts.map(a=>`<option value="${a.id}" ${a.id===w.account_id?"selected":""}>${esc(a.from_email)} · ${a.type==="sendgrid"?"SendGrid":"SMTP"}</option>`).join("");
    el("wizbody").innerHTML=`
      <h3>Campaign</h3><p class="hint">Name your blast and pick which account it sends from.</p>
      <div class="field"><label class="fl">Campaign name</label><input id="w_name" class="fld" value="${esc(w.name)}" placeholder="Q3 Product Update — Cohort A"></div>
      <div class="field"><label class="fl">Send from</label>
        ${state.accounts.length?`<select id="w_acct" class="fld">${opts}</select>`
          :`<div class="err">No sending accounts yet. <b style="cursor:pointer" id="goAcct">Connect one first.</b></div>`}
      </div>`;
    el("goAcct")?.addEventListener("click",()=>go("accounts"));
  }
  function wizCompose(){
    const w=state.wiz;
    const tplOpts=`<option value="">— start from scratch —</option>`+state.templates.map(t=>`<option value="${t.id}" ${t.id===w.template_id?"selected":""}>${esc(t.name)}</option>`).join("");
    el("wizbody").innerHTML=`
      <h3>Compose</h3><p class="hint">Write the email. Use <b>{{column_name}}</b> tokens to personalise per recipient.</p>
      ${state.templates.length?`<div class="field"><label class="fl">Load a template</label><select id="w_tpl" class="fld">${tplOpts}</select></div>`:""}
      <div class="field"><label class="fl">Subject</label><input id="w_subj" class="fld" value="${esc(w.subject)}" placeholder="Pengingat jatuh tempo — {{nama_lengkap}}"></div>
      <div class="field"><label class="fl">Body (HTML supported)</label>
        <textarea id="w_body" class="fld" rows="10" placeholder="Halo {{nama_lengkap}},\n\n...">${esc(w.body)}</textarea>
      </div>
      <div class="muted" style="font-size:12px">An unsubscribe footer is appended automatically to comply with bulk-mail rules.</div>`;
    el("w_tpl")?.addEventListener("change",(e)=>{
      const t=state.templates.find(x=>x.id===e.target.value);
      el("w_subj").value=t?t.subject:""; el("w_body").value=t?t.body_html:""; w.template_id=e.target.value;
    });
  }
  function wizRecipients(){
    const w=state.wiz;
    const hasData=w.recipients.length>0;
    el("wizbody").innerHTML=`
      <h3>Recipients</h3><p class="hint">Upload a CSV. The first row must be column headers, one of which is the email address.</p>
      <div class="drop" id="drop">
        <input id="csv" type="file" accept=".csv" class="hide">
        <b>${hasData?`${fmt(w.recipients.length)} recipients loaded`:"Click to upload a CSV"}</b><br>
        <small>${hasData?"Click to replace":"or drag a file here · columns become merge variables"}</small>
      </div>
      <div id="mapWrap" class="${hasData?"":"hide"}" style="margin-top:18px"></div>`;
    const drop=el("drop"), file=el("csv");
    drop.addEventListener("click",()=>file.click());
    drop.addEventListener("dragover",(e)=>{e.preventDefault();drop.style.background="#eef3ff";});
    drop.addEventListener("dragleave",()=>drop.style.background="");
    drop.addEventListener("drop",(e)=>{e.preventDefault();drop.style.background="";if(e.dataTransfer.files[0])parseCsv(e.dataTransfer.files[0]);});
    file.addEventListener("change",()=>{ if(file.files[0]) parseCsv(file.files[0]); });
    if(hasData) renderMapping();
  }
  function parseCsv(f){
    window.Papa.parse(f,{header:true,skipEmptyLines:true,complete:(res)=>{
      const rows=res.data.filter(r=>Object.values(r).some(v=>String(v).trim()));
      if(!rows.length){ toast("That CSV looks empty",true); return; }
      const w=state.wiz; w.columns=res.meta.fields||Object.keys(rows[0]);
      w.recipients=rows;
      w.emailCol = w.columns.find(c=>/e-?mail/i.test(c)) || w.columns[0];
      w.mapping={}; w.columns.forEach(c=>{ if(c!==w.emailCol) w.mapping[c]=slug(c); });
      viewWizard();
    }, error:()=>toast("Could not read that file",true)});
  }
  const slug=(s)=>String(s).toLowerCase().trim().replace(/[^a-z0-9]+/g,"_").replace(/^_|_$/g,"");
  function renderMapping(){
    const w=state.wiz;
    const sample=w.recipients[0]||{};
    const valid=w.recipients.filter(r=>/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(r[w.emailCol]||"").trim())).length;
    const colOpts=(sel)=>w.columns.map(c=>`<option value="${esc(c)}" ${c===sel?"selected":""}>${esc(c)}</option>`).join("");
    el("mapWrap").innerHTML=`
      <div class="field"><label class="fl">Which column is the email address?</label>
        <select id="emailCol" class="fld">${colOpts(w.emailCol)}</select></div>
      <div class="panel" style="box-shadow:none">
        <table><thead><tr><th>CSV column</th><th>Sample</th><th>Merge token</th></tr></thead><tbody>
        ${w.columns.map(c=>{
          if(c===w.emailCol) return `<tr><td><b>${esc(c)}</b></td><td class="muted">${esc(sample[c]??"")}</td><td><span class="chip" style="cursor:default">recipient email</span></td></tr>`;
          return `<tr><td>${esc(c)}</td><td class="muted">${esc(sample[c]??"")}</td><td><code>{{${esc(w.mapping[c]||slug(c))}}}</code></td></tr>`;
        }).join("")}
        </tbody></table>
      </div>
      <div class="row" style="margin-top:14px">
        <div class="stat" style="min-width:140px"><div class="v">${fmt(w.recipients.length)}</div><div class="l">Total rows</div></div>
        <div class="stat" style="min-width:140px"><div class="v" style="color:var(--green)">${fmt(valid)}</div><div class="l">Valid emails</div></div>
        <div class="stat" style="min-width:140px"><div class="v" style="color:var(--red)">${fmt(w.recipients.length-valid)}</div><div class="l">Invalid · skipped</div></div>
      </div>`;
    el("emailCol").addEventListener("change",(e)=>{ w.emailCol=e.target.value;
      w.mapping={}; w.columns.forEach(c=>{ if(c!==w.emailCol) w.mapping[c]=slug(c); }); renderMapping(); });
  }
  function wizVerify(){
    const w=state.wiz, a=state.accounts.find(x=>x.id===w.account_id);
    const valid=w.recipients.filter(r=>/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(r[w.emailCol]||"").trim())).length;
    const ck=(ok,label,detail,warn)=>{
      const c=ok?"var(--green)":warn?"var(--amber)":"var(--red)";
      const bg=ok?"var(--green-bg)":warn?"var(--amber-bg)":"var(--red-bg)";
      const tag=ok?"OK":warn?"CHECK":"FIX";
      const icon=ok?'<polyline points="20 6 9 17 4 12"/>':warn?'<line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>':'<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>';
      return `<div class="check"><div class="ci" style="background:${bg}"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">${icon}</svg></div>
        <div class="cd"><b>${label}</b><div>${detail}</div></div><span class="tag" style="background:${bg};color:${c}">${tag}</span></div>`;
    };
    el("wizbody").innerHTML=`
      <h3>Verify</h3><p class="hint">Last checks before sending.</p>
      ${ck(!!a,"Sending account", a?`${esc(a.from_email)} · ${a.type==="sendgrid"?"SendGrid":"SMTP"}`:"No account selected")}
      ${ck(!!w.subject.trim()&&!!w.body.trim(),"Email content", (w.subject.trim()&&w.body.trim())?`Subject set · ${countVars(w.body)} merge vars`:"Subject and body required")}
      ${ck(valid>0,"Recipients", `${fmt(valid)} valid · ${fmt(w.recipients.length-valid)} invalid will be skipped`)}
      ${ck(true,"Unsubscribe footer","Auto-appended to every email",true)}`;
  }
  function wizSend(){
    const w=state.wiz, a=state.accounts.find(x=>x.id===w.account_id);
    const valid=w.recipients.filter(r=>/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(r[w.emailCol]||"").trim())).length;
    const r=(k,v)=>`<tr><td class="muted" style="width:160px">${k}</td><td><b>${v}</b></td></tr>`;
    el("wizbody").innerHTML=`
      <h3>Ready to send</h3><p class="hint">Review and send. Sending runs in the background; the dashboard updates as it goes.</p>
      <div class="panel" style="box-shadow:none"><table>
        ${r("Campaign",esc(w.name||"Untitled"))}
        ${r("From",esc(a?a.from_email:"—"))}
        ${r("Recipients",fmt(valid))}
        ${r("Subject",esc(w.subject||"—"))}
        ${r("Merge variables",countVars(w.body))}
      </table></div>`;
  }

  async function wizNext(){
    const w=state.wiz, btn=el("wNext"), orig=btn.textContent;
    if(w.step===1){
      w.name=val("w_name"); if(el("w_acct")) w.account_id=el("w_acct").value;
      if(!w.name){ toast("Name your campaign",true); return; }
      if(!w.account_id){ toast("Pick a sending account",true); return; }
    }
    if(w.step===2){
      w.subject=val("w_subj"); w.body=val("w_body");
      if(!w.subject||!w.body){ toast("Subject and body are required",true); return; }
    }
    if(w.step===3){
      if(!w.recipients.length){ toast("Upload recipients first",true); return; }
    }
    if(w.step>=5){ await doSend(btn,orig); return; }
    w.step++; viewWizard();
  }

  async function doSend(btn,orig){
    const w=state.wiz;
    btn.disabled=true; btn.innerHTML='<span class="spin"></span> Preparing…';
    try{
      const valids=w.recipients.filter(r=>/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(r[w.emailCol]||"").trim()));
      // 1) campaign row
      const camp={ user_id:state.user.id,name:w.name,account_id:w.account_id,template_id:w.template_id||null,
        subject:w.subject,body_html:w.body,status:"queued",total:valids.length,sent:0,failed:0 };
      let campaignId=w.campaignId;
      if(campaignId){ await sb.from("campaigns").update(camp).eq("id",campaignId);
        await sb.from("recipients").delete().eq("campaign_id",campaignId); }
      else { const ins=await sb.from("campaigns").insert(camp).select("id").single();
        if(ins.error) throw ins.error; campaignId=ins.data.id; }
      // 2) recipients
      const rows=valids.map(r=>{
        const merge={}; for(const c of w.columns){ if(c!==w.emailCol) merge[w.mapping[c]||slug(c)]=r[c]; }
        return { campaign_id:campaignId,user_id:state.user.id,email:String(r[w.emailCol]).trim(),merge_data:merge,status:"pending" };
      });
      for(let i=0;i<rows.length;i+=500){ const ck=await sb.from("recipients").insert(rows.slice(i,i+500)); if(ck.error) throw ck.error; }
      // 3) trigger background sender
      btn.innerHTML='<span class="spin"></span> Sending…';
      const { data:{ session } }=await sb.auth.getSession();
      const resp=await fetch("/.netlify/functions/send-blast-background",{
        method:"POST",headers:{ "Content-Type":"application/json","Authorization":"Bearer "+session.access_token },
        body:JSON.stringify({ campaign_id:campaignId })
      });
      if(!resp.ok && resp.status!==202){
        const tx=await resp.text();
        throw new Error("Send endpoint returned "+resp.status+". "+tx.slice(0,140));
      }
      await sb.from("campaigns").update({status:"sending"}).eq("id",campaignId);
      await loadAll(); state.wiz=null; go("dashboard");
      toast("Blast queued — sending in the background");
    }catch(err){
      console.error(err);
      toast(err.message||"Could not start the send",true);
      btn.disabled=false; btn.textContent=orig;
    }
  }

  // =====================================================================
  //  MODAL
  // =====================================================================
  function openModal({title,body,okLabel="Save",onOk,after}){
    const root=el("modalRoot");
    root.innerHTML=`<div class="scrim"><div class="modal">
      <div class="mh"><h3>${esc(title)}</h3><button class="x" id="mClose">✕</button></div>
      <div class="mb">${body}</div>
      <div class="mf"><button class="btn btn-ghost" id="mCancel">Cancel</button><button class="btn btn-primary" id="mOk" style="width:auto">${esc(okLabel)}</button></div>
    </div></div>`;
    const close=()=>root.innerHTML="";
    el("mClose").onclick=close; el("mCancel").onclick=close;
    $(".scrim").addEventListener("click",(e)=>{ if(e.target.classList.contains("scrim")) close(); });
    el("mOk").onclick=async()=>{
      const ok=el("mOk"); ok.disabled=true; const o=ok.textContent; ok.innerHTML='<span class="spin"></span>';
      const r=await onOk(); ok.disabled=false; ok.textContent=o;
      if(r!==false) close();
    };
    after && after();
  }

  // =====================================================================
  //  BOOT
  // =====================================================================
  renderAuthMode();
  // supabase-js fires onAuthStateChange with INITIAL_SESSION on load, which
  // handles both the logged-in and logged-out boot cases — no manual call needed.
})();
