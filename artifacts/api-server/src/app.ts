import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes/index.js";
import sitemapRouter from "./routes/sitemap.js";
import seoPagesRouter from "./routes/seo-pages.js";
import { globalRateLimiter, rateLimit } from "./middleware/rate-limit.js";
import { logger } from "./lib/logger.js";

const app: Express = express();
app.disable("x-powered-by");
app.use((_req,res,next)=>{
  res.setHeader("X-Content-Type-Options","nosniff");
  res.setHeader("X-Frame-Options","DENY");
  res.setHeader("Referrer-Policy","strict-origin-when-cross-origin");
  res.setHeader("X-XSS-Protection","0");
  res.setHeader("Permissions-Policy","camera=(), microphone=(), geolocation=()");
  next();
});

app.use(pinoHttp({
  logger,
  serializers:{
    req(req){return {id:req.id,method:req.method,url:req.url?.split("?")[0]};},
    res(res){return {statusCode:res.statusCode};}
  }
}));

const DEFAULT_ALLOWED_ORIGINS=new Set(["https://chuglii.in","https://www.chuglii.in"]);
const CONFIGURED_ALLOWED_ORIGINS=new Set((process.env.CORS_ALLOWED_ORIGINS??"").split(",").map(v=>v.trim()).filter(Boolean));
const deploymentHost=process.env.VERCEL_URL?.trim();
if(deploymentHost){
  try{
    const url=new URL(deploymentHost.startsWith("http")?deploymentHost:"https://"+deploymentHost);
    if(url.protocol==="https:") CONFIGURED_ALLOWED_ORIGINS.add(url.origin);
  }catch{/* Ignore malformed platform metadata. */}
}
function isAllowedOrigin(origin:string|undefined):boolean{
  if(!origin) return true;
  if(DEFAULT_ALLOWED_ORIGINS.has(origin)||CONFIGURED_ALLOWED_ORIGINS.has(origin)) return true;
  try{
    const url=new URL(origin);
    return url.protocol==="http:"&&(url.hostname==="localhost"||url.hostname==="127.0.0.1");
  }catch{return false;}
}
app.use(cors({origin:(origin,callback)=>callback(null,isAllowedOrigin(origin)),credentials:true}));
app.use("/api",globalRateLimiter);
const writeLimiter=rateLimit({bucket:"write"});
app.use("/api",(req,res,next)=>{
  if(req.method!=="GET"&&req.method!=="HEAD"){writeLimiter(req,res,next);return;}
  next();
});
app.use("/api/premium/webhook",express.raw({type:"*/*",limit:"1mb"}));
app.use(express.json({limit:"1mb"}));
app.use(express.urlencoded({extended:true,limit:"1mb"}));
app.use("/api",router);
app.use(seoPagesRouter);
app.use(sitemapRouter);
app.use((err:unknown,_req:Request,res:Response,_next:NextFunction)=>{
  const status=(err as {status?:number})?.status??(err as {statusCode?:number})?.statusCode??500;
  if(status>=400&&status<500){
    logger.warn({err},"Bad request rejected");
    if(res.headersSent)return;
    res.status(status).json({error:"Bad request"});
    return;
  }
  logger.error({err},"Unhandled route error");
  if(res.headersSent)return;
  res.status(500).json({error:"Internal server error"});
});
export default app;
