import { Router, type Request, type Response } from "express";
import { supabase } from "../lib/supabase.js";
import { requireAuth } from "../middleware/auth.js";
import { requireRole } from "../middleware/requireRole.js";
import { logger } from "../lib/logger.js";

const router=Router();
const admin=requireRole("admin");
const REASONS=new Set(["privacy","consent","copyright","impersonation","other"]);
const STATUSES=new Set(["pending","reviewing","resolved","rejected"]);
const EMAIL_RE=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function safeContentUrl(value:unknown):string|null {
 if(typeof value!=="string" || value.length>2048) return null;
 try {
  const url=new URL(value.trim());
  if(url.protocol!=="https:" || !["chuglii.in","www.chuglii.in"].includes(url.hostname)) return null;
  return url.toString();
 } catch { return null; }
}

router.post("/content-removal-requests",async(req,res)=>{
 const body=(req.body??{}) as Record<string,unknown>;
 if(typeof body.company_website==="string" && body.company_website.trim()) { res.status(202).json({accepted:true}); return; }
 const contentUrl=safeContentUrl(body.content_url);
 const reason=typeof body.reason==="string"?body.reason.trim():"";
 const details=typeof body.details==="string"?body.details.trim():"";
 const email=typeof body.contact_email==="string"?body.contact_email.trim():"";
 if(!contentUrl) { res.status(400).json({error:"Enter a valid https://chuglii.in page URL."}); return; }
 if(!REASONS.has(reason)) { res.status(400).json({error:"Choose a valid report reason."}); return; }
 if(details.length<20 || details.length>3000) { res.status(400).json({error:"Details must be between 20 and 3,000 characters."}); return; }
 if(email && (email.length>254 || !EMAIL_RE.test(email))) { res.status(400).json({error:"Enter a valid contact email or leave it blank."}); return; }
 try {
  const {data,error}=await supabase.from("content_removal_requests").insert({
   content_url:contentUrl,reason,details,contact_email:email||null,status:"pending"
  }).select("id,status,created_at").single();
  if(error) throw error;
  res.status(201).json({accepted:true,request_id:data.id,status:data.status,created_at:data.created_at});
 } catch(err) {
  req.log?.error?.({err},"Content removal request could not be saved");
  logger.error({err},"Content removal request could not be saved");
  res.status(503).json({error:"The report could not be saved right now. Please try again later."});
 }
});

router.get("/admin/content-removal-requests",requireAuth,admin,async(_req: Request,res: Response)=>{
 const {data,error}=await supabase.from("content_removal_requests")
  .select("id,content_url,reason,details,contact_email,status,admin_notes,created_at,reviewed_at,reviewed_by")
  .order("created_at",{ascending:false}).limit(100);
 if(error) { logger.error({err:error},"Admin content removal queue query failed"); res.status(503).json({error:"Could not load the content removal queue."}); return; }
 res.json(data??[]);
});

router.patch("/admin/content-removal-requests/:id",requireAuth,admin,async(req: Request,res: Response)=>{
 const id=String(req.params.id??"");
 const status=typeof req.body?.status==="string"?req.body.status:"";
 const adminNotes=typeof req.body?.admin_notes==="string"?req.body.admin_notes.trim():"";
 if(!/^[0-9a-f-]{36}$/i.test(id) || !STATUSES.has(status) || adminNotes.length>3000) {
  res.status(400).json({error:"Invalid request id, status or admin notes."}); return;
 }
 const {data,error}=await supabase.from("content_removal_requests").update({
  status,admin_notes:adminNotes||null,reviewed_at:new Date().toISOString(),reviewed_by:req.user!.id
 }).eq("id",id).select("id,status,admin_notes,reviewed_at,reviewed_by").maybeSingle();
 if(error) { logger.error({err:error},"Admin content removal request update failed"); res.status(503).json({error:"Could not update the content removal request."}); return; }
 if(!data) { res.status(404).json({error:"Content removal request not found."}); return; }
 res.json(data);
});

export default router;
