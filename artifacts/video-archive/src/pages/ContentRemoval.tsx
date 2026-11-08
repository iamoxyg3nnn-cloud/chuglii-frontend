import { useState, type FormEvent } from "react";
import { Link } from "wouter";
import { AlertCircle, CheckCircle2, ShieldCheck } from "lucide-react";
import { Layout } from "@/components/Layout";

const REASONS=[
 {value:"privacy",label:"Privacy concern"},
 {value:"consent",label:"Consent or authorization concern"},
 {value:"copyright",label:"Copyright or ownership"},
 {value:"impersonation",label:"Impersonation or incorrect attribution"},
 {value:"other",label:"Other legal or safety concern"},
];

export default function ContentRemoval() {
 const [contentUrl,setContentUrl]=useState(()=>{
  if(typeof window==="undefined") return "";
  const raw=new URLSearchParams(window.location.search).get("url");
  if(!raw) return "";
  try { return new URL(raw,window.location.origin).toString(); } catch { return ""; }
 });
 const [reason,setReason]=useState("privacy");
 const [details,setDetails]=useState("");
 const [email,setEmail]=useState("");
 const [honeypot,setHoneypot]=useState("");
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState("");
 const [requestId,setRequestId]=useState("");

 async function handleSubmit(event:FormEvent<HTMLFormElement>) {
  event.preventDefault(); setBusy(true); setError("");
  try {
   const response=await fetch("/api/content-removal-requests",{
    method:"POST",
    headers:{"Content-Type":"application/json"},
    body:JSON.stringify({content_url:contentUrl,reason,details,contact_email:email,company_website:honeypot})
   });
   const result=await response.json().catch(()=>({}));
   if(!response.ok) throw new Error(result.error||"Could not submit the report.");
   setRequestId(result.request_id||"received");
   setContentUrl(""); setDetails(""); setEmail(""); setHoneypot("");
  } catch(err) {
   setError(err instanceof Error?err.message:"Could not submit the report.");
  } finally { setBusy(false); }
 }

 return <Layout>
  <section className="container mx-auto max-w-3xl px-4 sm:px-6 py-12">
   <div className="mb-8 flex items-start gap-3">
    <div className="rounded-xl border border-primary/20 bg-primary/10 p-3 text-primary"><ShieldCheck className="h-5 w-5"/></div>
    <div>
     <p className="text-xs uppercase tracking-[0.25em] text-muted-foreground">Safety &amp; privacy</p>
     <h1 className="mt-2 text-2xl font-black tracking-tight">Report content or request removal</h1>
     <p className="mt-3 text-sm leading-6 text-muted-foreground">Report a listing that may violate privacy, consent, copyright, attribution or applicable law. Include enough detail for a reviewer to locate and assess the content.</p>
    </div>
   </div>
   {requestId? <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-6">
    <CheckCircle2 className="h-6 w-6 text-emerald-500"/>
    <h2 className="mt-3 text-lg font-semibold">Report received</h2>
    <p className="mt-2 text-sm text-muted-foreground">Your report was recorded. Reference: <span className="font-mono">{requestId}</span>. This is an acknowledgement, not a finding or a guarantee of removal.</p>
    <button className="mt-5 h-10 rounded-lg border border-border px-4 text-sm" onClick={()=>setRequestId("")}>Submit another report</button>
   </div>: <form onSubmit={handleSubmit} className="space-y-5 rounded-xl border border-border/60 bg-card p-5 sm:p-7">
    <div>
     <label className="mb-2 block text-sm font-medium" htmlFor="content-url">Page URL</label>
     <input id="content-url" required type="url" value={contentUrl} onChange={e=>setContentUrl(e.target.value)} placeholder="https://chuglii.in/video/..." className="h-11 w-full rounded-lg border border-border bg-background px-3 text-sm"/>
    </div>
    <div>
     <label className="mb-2 block text-sm font-medium" htmlFor="reason">Reason for report</label>
     <select id="reason" value={reason} onChange={e=>setReason(e.target.value)} className="h-11 w-full rounded-lg border border-border bg-background px-3 text-sm">{REASONS.map(item=><option key={item.value} value={item.value}>{item.label}</option>)}</select>
    </div>
    <div>
     <label className="mb-2 block text-sm font-medium" htmlFor="details">Details</label>
     <textarea id="details" required minLength={20} maxLength={3000} rows={6} value={details} onChange={e=>setDetails(e.target.value)} placeholder="Explain the concern and identify the specific material that should be reviewed." className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"/>
     <p className="mt-1 text-xs text-muted-foreground">{details.length}/3000 characters</p>
    </div>
    <div>
     <label className="mb-2 block text-sm font-medium" htmlFor="contact-email">Contact email (optional)</label>
     <input id="contact-email" type="email" maxLength={254} value={email} onChange={e=>setEmail(e.target.value)} placeholder="you@example.com" className="h-11 w-full rounded-lg border border-border bg-background px-3 text-sm"/>
     <p className="mt-1 text-xs text-muted-foreground">Used only if a reviewer needs clarification about this report.</p>
    </div>
    <div aria-hidden="true" className="absolute -left-[10000px] h-px w-px overflow-hidden">
     <label htmlFor="company-website">Leave this field empty</label>
     <input id="company-website" tabIndex={-1} autoComplete="off" value={honeypot} onChange={e=>setHoneypot(e.target.value)}/>
    </div>
    {error&&<p role="alert" className="flex items-start gap-2 text-sm text-destructive"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0"/>{error}</p>}
    <button disabled={busy} type="submit" className="h-11 w-full rounded-lg bg-primary px-5 text-sm font-semibold text-primary-foreground disabled:opacity-60">{busy?"Submitting…":"Submit report"}</button>
    <p className="text-xs leading-5 text-muted-foreground">Please provide accurate information. False or abusive reports may delay review. An acknowledgement does not guarantee removal.</p>
   </form>}
   <p className="mt-6 text-sm text-muted-foreground"><Link href="/" className="text-primary hover:underline">Return to VAULT</Link></p>
  </section>
 </Layout>;
}
