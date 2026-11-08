import { Router } from "express";
import { supabase } from "../lib/supabase.js";
import { logger } from "../lib/logger.js";

/**
 * Sitemap for VAULT's public catalogue.
 * Individual recordings and performer profiles are excluded by default.
 * Enable detail URLs only after a documented rights/consent review.
 */
const router=Router();
const SITE="https://chuglii.in";
const DETAIL_INDEXING_ENABLED=process.env.SEO_INDEX_DETAIL_PAGES==="true";
const MAX_RECORDINGS=10_000,MAX_PERFORMERS=5_000,MAX_TAGS=2_500;
const MIN_TAG_RECORDINGS=5,PAGE_SIZE=1_000,CACHE_TTL_MS=6*60*60*1_000;
interface SitemapEntry{loc:string;lastmod?:string|null}
interface RecordingRow{id?:string|number|null;username?:string|null;updated_at?:string|null;timestamp?:string|null}
interface PerformerRow{username?:string|null;latest_timestamp?:string|null}
interface TagRow{tag?:string|null;count?:number|string|null}
function escapeXml(value:string):string{return value.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&apos;");}
function toLastmod(value:string|null|undefined):string|null{
 if(!value)return null;
 const date=new Date(value);
 return Number.isNaN(date.getTime())?null:date.toISOString().slice(0,10);
}
function renderEntry(entry:SitemapEntry):string{
 const parts=["    <loc>"+escapeXml(entry.loc)+"</loc>"];
 if(entry.lastmod)parts.push("    <lastmod>"+entry.lastmod+"</lastmod>");
 return "  <url>\n"+parts.join("\n")+"\n  </url>";
}
function buildSitemap(entries:SitemapEntry[]):string{
 return ['<?xml version="1.0" encoding="UTF-8"?>','<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',...entries.map(renderEntry),"</urlset>",""].join("\n");
}
function coreEntries():SitemapEntry[]{
 return [{loc:SITE+"/"},{loc:SITE+"/browse"},{loc:SITE+"/performers"},{loc:SITE+"/tags"},{loc:SITE+"/premium"},{loc:SITE+"/playlists"}];
}
async function fetchRecordings():Promise<RecordingRow[]>{
 const rows:RecordingRow[]=[];
 for(let start=0;start<MAX_RECORDINGS;start+=PAGE_SIZE){
  const end=Math.min(start+PAGE_SIZE-1,MAX_RECORDINGS-1);
  const {data,error}=await supabase.from("linked_recordings").select("id,username,updated_at,timestamp")
   .order("timestamp",{ascending:false,nullsFirst:false}).order("id",{ascending:false}).range(start,end);
  if(error)throw error;
  rows.push(...((data??[]) as RecordingRow[]));
  if(!data||data.length<PAGE_SIZE)break;
 }
 return rows;
}
async function fetchPerformers(fallback:string[]):Promise<PerformerRow[]>{
 try{
  const {data,error}=await supabase.rpc("get_performer_stats");
  if(!error&&Array.isArray(data))return (data as PerformerRow[]).slice(0,MAX_PERFORMERS);
  if(error)logger.warn({err:error},"sitemap: performer RPC unavailable");
 }catch(err){logger.warn({err},"sitemap: performer RPC unavailable, using recording usernames");}
 return fallback.slice(0,MAX_PERFORMERS).map(username=>({username}));
}
async function fetchTags():Promise<TagRow[]>{
 try{
  const {data,error}=await supabase.rpc("get_tag_counts");
  if(!error&&Array.isArray(data))return (data as TagRow[]).slice(0,MAX_TAGS);
  if(error)logger.warn({err:error},"sitemap: tag RPC unavailable");
 }catch(err){logger.warn({err},"sitemap: tag RPC unavailable");}
 return [];
}
async function generateSitemap():Promise<string>{
 const entries=coreEntries();
 if(DETAIL_INDEXING_ENABLED){
  const recordings=await fetchRecordings();
  for(const row of recordings){
   if(row.id==null||row.id==="")continue;
   entries.push({loc:SITE+"/video/"+encodeURIComponent(String(row.id)),lastmod:toLastmod(row.updated_at??row.timestamp)??undefined});
  }
  const names=[...new Set(recordings.map(row=>row.username?.trim()).filter((name):name is string=>Boolean(name)))];
  for(const row of await fetchPerformers(names)){
   const username=row.username?.trim();
   if(!username)continue;
   entries.push({loc:SITE+"/performers/"+encodeURIComponent(username),lastmod:toLastmod(row.latest_timestamp)??undefined});
  }
 }
 for(const row of await fetchTags()){
  const tag=row.tag?.trim(),count=Number(row.count??0);
  if(!tag||!Number.isFinite(count)||count<MIN_TAG_RECORDINGS)continue;
  entries.push({loc:SITE+"/browse?tags="+encodeURIComponent(tag)});
 }
 return buildSitemap(entries);
}
let cached:{body:string;expiresAt:number}|null=null;
let inflight:Promise<string>|null=null;
async function getSitemap():Promise<string>{
 if(cached&&cached.expiresAt>Date.now())return cached.body;
 if(inflight)return inflight;
 inflight=generateSitemap().then(body=>{cached={body,expiresAt:Date.now()+CACHE_TTL_MS};return body;}).finally(()=>{inflight=null;});
 return inflight;
}
router.get(["/sitemap","/sitemap.xml"],async(_req,res)=>{
 try{
  res.set("Content-Type","application/xml; charset=utf-8");
  res.set("Cache-Control","public, max-age=3600, s-maxage=21600, stale-while-revalidate=86400, stale-if-error=86400");
  res.send(await getSitemap());
 }catch(err){
  logger.error({err},"sitemap: generation failed");
  res.status(503).type("application/xml").send(buildSitemap(coreEntries()));
 }
});
export default router;
