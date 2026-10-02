import { query } from "./db.mjs";
import { loadCredential } from "./credentialVault.mjs";
import { getGoogleAccessToken } from "./youtube.mjs";
import { getBlueskyAgent } from "./blueskyOAuth.mjs";

const GRAPH_VERSION = String(process.env.META_GRAPH_VERSION || "v26.0").replace(/^v?/, "v");

async function json(url, options={}) {
  const response = await fetch(url, options);
  const raw = await response.text();
  let data={};
  try{data=raw?JSON.parse(raw):{};}catch{}
  if(!response.ok || data.error || data.errors || data.message){
    const msg=data.error?.message || data.error_description || data.message || data.errors?.[0]?.message || response.statusText || "Platform request failed.";
    const error=new Error(String(msg));
    error.status=response.status;
    error.body=data;
    throw error;
  }
  return data;
}

function metrics(input={}) {
  const out={source:input.source||"platform"};
  for(const key of ["views","likes","comments","shares","replies","reposts","saves","reblogs","favourites"]){
    out[key]=input[key]==null?null:Number(input[key]);
  }
  return out;
}

async function facebook(job, credential){
  const token=credential.pageAccessToken||credential.accessToken;
  const data=await json("https://graph.facebook.com/"+GRAPH_VERSION+"/"+encodeURIComponent(job.external_post_id)+"?fields=shares,comments.summary(true),likes.summary(true),views",{
    headers:{Authorization:"Bearer "+token}
  });
  return metrics({
    views:data.views,
    shares:data.shares?.count,
    comments:data.comments?.summary?.total_count,
    likes:data.likes?.summary?.total_count,
    source:"facebook"
  });
}

async function instagram(job, credential){
  const data=await json("https://graph.facebook.com/"+GRAPH_VERSION+"/"+encodeURIComponent(job.external_post_id)+"?fields=like_count,comments_count,media_type",{
    headers:{Authorization:"Bearer "+credential.accessToken}
  });
  return metrics({likes:data.like_count,comments:data.comments_count,source:"instagram"});
}

async function youtube(job, credential){
  const token=await getGoogleAccessToken({clientId:credential.clientId,clientSecret:credential.clientSecret,refreshToken:credential.refreshToken});
  const data=await json("https://www.googleapis.com/youtube/v3/videos?part=statistics&id="+encodeURIComponent(job.external_post_id),{
    headers:{Authorization:"Bearer "+token}
  });
  const s=data.items?.[0]?.statistics||{};
  return metrics({views:s.viewCount,likes:s.likeCount,comments:s.commentCount,source:"youtube"});
}

async function x(job, credential){
  const data=await json("https://api.x.com/2/tweets?ids="+encodeURIComponent(job.external_post_id)+"&tweet.fields=public_metrics",{
    headers:{Authorization:"Bearer "+credential.accessToken}
  });
  const p=data.data?.[0]?.public_metrics||{};
  return metrics({likes:p.like_count,replies:p.reply_count,reposts:p.retweet_count,shares:p.quote_count,source:"x"});
}

async function mastodon(job, credential){
  const data=await json(String(credential.instance).replace(/\/+$/,"")+"/api/v1/statuses/"+encodeURIComponent(job.external_post_id),{
    headers:{Authorization:"Bearer "+credential.accessToken}
  });
  return metrics({likes:data.favourites_count,replies:data.replies_count,reblogs:data.reblogs_count,source:"mastodon"});
}

async function bluesky(job, credential){
  const agent=await getBlueskyAgent(job.workspace_id,credential.did||job.external_account_id);
  const data=(await agent.getPostThread({uri:job.external_post_id,depth:0})).data?.thread;
  return metrics({likes:data?.likeCount,replies:data?.replyCount,reposts:data?.repostCount,source:"bluesky"});
}

export async function syncPostMetrics(job){
  if(!job.external_post_id) return {jobId:job.id,ok:false,unsupported:true,error:"No external post ID."};
  const credential=await loadCredential(job.workspace_id,job.credential_ref);
  if(!credential) throw new Error("Encrypted credentials are missing for this publishing account.");
  let result;
  switch(job.platform){
    case "facebook": result=await facebook(job,credential); break;
    case "instagram": result=await instagram(job,credential); break;
    case "youtube": result=await youtube(job,credential); break;
    case "x": result=await x(job,credential); break;
    case "mastodon": result=await mastodon(job,credential); break;
    case "bluesky": result=await bluesky(job,credential); break;
    default: return {jobId:job.id,platform:job.platform,ok:false,unsupported:true,error:"Post metrics are not implemented for "+job.platform+"."};
  }
  const metricDate=new Date().toISOString().slice(0,10);
  await query(
    "INSERT INTO post_metric_snapshots (publishing_job_id,metric_date,metrics_json,source,error_message,fetched_at) VALUES ($1,$2,$3::jsonb,$4,NULL,now()) ON CONFLICT (publishing_job_id,metric_date) DO UPDATE SET metrics_json=EXCLUDED.metrics_json,source=EXCLUDED.source,error_message=NULL,fetched_at=now()",
    [job.id,metricDate,JSON.stringify(result),job.platform]
  );
  return {jobId:job.id,platform:job.platform,ok:true,metrics:result};
}

export async function listPostPerformance(workspaceId, limit=100){
  const result=await query(
    "SELECT * FROM (SELECT pj.id AS job_id,pj.external_post_id,pj.external_url,pj.completed_at,sa.platform,sa.name AS account_name,c.id AS content_id,c.title,c.profile_id,p.name AS profile_name,s.metric_date,s.metrics_json,s.error_message,s.fetched_at,ROW_NUMBER() OVER(PARTITION BY pj.id ORDER BY s.metric_date DESC) AS rn FROM publishing_jobs pj JOIN social_accounts sa ON sa.id=pj.social_account_id JOIN content_items c ON c.id=pj.content_item_id JOIN profiles p ON p.id=c.profile_id LEFT JOIN post_metric_snapshots s ON s.publishing_job_id=pj.id WHERE p.workspace_id=$1 AND pj.status='published' AND pj.external_post_id IS NOT NULL) q WHERE rn=1 ORDER BY completed_at DESC NULLS LAST LIMIT $2",
    [workspaceId,Math.min(500,Math.max(1,Number(limit||100)))]
  );
  return result.rows;
}
