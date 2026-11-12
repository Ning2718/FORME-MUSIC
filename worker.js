/* FORME MUSIC — Cloudflare Worker Baidu Netdisk gateway.
   Configure BAIDU_CLIENT_ID, BAIDU_CLIENT_SECRET, COOKIE_KEY as Wrangler secrets.
   Register https://YOUR_DOMAIN/auth/callback as Baidu OAuth redirect URI.
*/
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const security = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY' };
const makeJSON = (data, status=200, extra={}) => {const h=new Headers({'Content-Type':'application/json; charset=utf-8',...security});new Headers(extra).forEach((value,key)=>h.set(key,value));return new Response(JSON.stringify(data),{status,headers:h})};
const b64 = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const unb64 = str => Uint8Array.from(atob(str.replace(/-/g,'+').replace(/_/g,'/')+'='.repeat((4-str.length%4)%4)), c=>c.charCodeAt(0));
const getCookies = req => Object.fromEntries((req.headers.get('Cookie')||'').split(';').map(s=>s.trim()).filter(s=>s.includes('=')).map(s=>[s.slice(0,s.indexOf('=')),s.slice(s.indexOf('=')+1)]));
const cookie = (name,value,maxAge) => `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
async function cipher(env) {
  if(!env.COOKIE_KEY || env.COOKIE_KEY.length < 32) throw new Error('COOKIE_KEY 未配置或长度小于32字符');
  const hash=await crypto.subtle.digest('SHA-256',encoder.encode(env.COOKIE_KEY));
  return crypto.subtle.importKey('raw',hash,'AES-GCM',false,['encrypt','decrypt']);
}
async function seal(value, env) {
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const encrypted=await crypto.subtle.encrypt({name:'AES-GCM',iv},await cipher(env),encoder.encode(JSON.stringify(value)));
  return `${b64(iv)}.${b64(encrypted)}`;
}
async function unseal(value,env) {
  if(!value) return null;
  try {const [iv,data]=value.split('.');return JSON.parse(decoder.decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:unb64(iv)},await cipher(env),unb64(data))));}
  catch {return null;}
}
async function tokenRequest(params) {
  const res=await fetch('https://openapi.baidu.com/oauth/2.0/token?'+new URLSearchParams(params),{headers:{Accept:'application/json'}});
  const body=await res.json();
  if(!res.ok||!body.access_token) throw new Error(body.error_description || body.error || '百度授权令牌获取失败');
  return body;
}
async function auth(req,env) {
  const cookies=getCookies(req);
  let token=await unseal(cookies.forme_auth,env);
  if(!token) return { error:makeJSON({error:'请先连接百度网盘',auth:false},401) };
  let setCookie;
  if(Date.now() > (token.expiresAt||0)-300000) {
    if(!token.refresh_token) return {error:makeJSON({error:'授权已过期，请重新连接'},401)};
    const refreshed=await tokenRequest({grant_type:'refresh_token',refresh_token:token.refresh_token,client_id:env.BAIDU_CLIENT_ID,client_secret:env.BAIDU_CLIENT_SECRET});
    token={...token,...refreshed,expiresAt:Date.now()+(Number(refreshed.expires_in)||2592000)*1000};
    setCookie=cookie('forme_auth',await seal(token,env),60*60*24*30);
  }
  return {token:token.access_token,setCookie};
}
function apiHeaders(session,extra={}) {const h=new Headers({...security,...extra});if(session?.setCookie)h.append('Set-Cookie',session.setCookie);return h;}
async function baiduJSON(url) {
  const res=await fetch(url,{headers:{Accept:'application/json'}});
  const data=await res.json();
  if(!res.ok || (typeof data.errno==='number' && data.errno!==0)) throw new Error(`百度网盘接口错误 ${data.errno ?? res.status}: ${data.errmsg || data.error_msg || '请检查权限、下载配额与文件状态'}`);
  return data;
}
async function handle(req,env) {
  const url=new URL(req.url), path=url.pathname;
  if(path==='/auth/start') {
    if(!env.BAIDU_CLIENT_ID||!env.BAIDU_CLIENT_SECRET||!env.COOKIE_KEY) return makeJSON({error:'未配置百度应用密钥 / COOKIE_KEY'},503);
    const state=b64(crypto.getRandomValues(new Uint8Array(24)));
    const redirect=`${url.origin}/auth/callback`;
    const dest=new URL('https://openapi.baidu.com/oauth/2.0/authorize');
    dest.search=new URLSearchParams({response_type:'code',client_id:env.BAIDU_CLIENT_ID,redirect_uri:redirect,scope:'basic,netdisk',state,display:'mobile'}).toString();
    return new Response(null,{status:302,headers:{Location:dest.toString(),'Set-Cookie':cookie('forme_state',state,600),...security}});
  }
  if(path==='/auth/callback') {
    const cookies=getCookies(req);
    if(!cookies.forme_state||cookies.forme_state!==url.searchParams.get('state')) return new Response('授权状态校验失败，请回到首页重试',{status:400,headers:security});
    const code=url.searchParams.get('code');
    if(!code) return new Response('授权未完成',{status:400,headers:security});
    const issued=await tokenRequest({grant_type:'authorization_code',code,client_id:env.BAIDU_CLIENT_ID,client_secret:env.BAIDU_CLIENT_SECRET,redirect_uri:`${url.origin}/auth/callback`});
    const session={...issued,expiresAt:Date.now()+(Number(issued.expires_in)||2592000)*1000};
    const h=new Headers({...security,Location:'/?connected=1'});
    h.append('Set-Cookie',cookie('forme_auth',await seal(session,env),60*60*24*30));
    h.append('Set-Cookie',cookie('forme_state','',0));
    return new Response(null,{status:302,headers:h});
  }
  if(path==='/api/logout') return makeJSON({ok:true},200,{'Set-Cookie':cookie('forme_auth','',0)});
  if(path==='/api/status') {
    const a=await auth(req,env);
    return a.error?makeJSON({connected:false}):makeJSON({connected:true},200,a.setCookie?{'Set-Cookie':a.setCookie}:{});
  }
  if(!path.startsWith('/api/')) return env.ASSETS.fetch(req);
  const a=await auth(req,env);if(a.error) return a.error;
  if(path==='/api/list') {
    const start=Math.max(0,Math.min(10000000,Number(url.searchParams.get('start'))||0));
    const limit=500;
    const ep=new URL('https://pan.baidu.com/rest/2.0/xpan/multimedia');
    ep.search=new URLSearchParams({method:'listall',access_token:a.token,path:'/',recursion:'1',start:String(start),limit:String(limit),web:'1'}).toString();
    const data=await baiduJSON(ep);
    const list=(data.list||[]).filter(x=>x.isdir!==1 && /\.(mp3|m4a|aac|wav|flac|ogg)$/i.test(x.server_filename||x.path||''))
      .map(x=>({id:String(x.fs_id),name:x.server_filename,path:x.path,size:x.size||0}));
    return makeJSON({list,received:(data.list||[]).length,has_more:!!data.has_more, next:start+(data.list||[]).length},200,apiHeaders(a));
  }
  const match=path.match(/^\/api\/audio\/(\d+)$/);
  if(match) {
    if(req.method!=='GET'&&req.method!=='HEAD') return makeJSON({error:'Method not allowed'},405);
    const ep=new URL('https://pan.baidu.com/rest/2.0/xpan/multimedia');
    ep.search=new URLSearchParams({method:'filemetas',access_token:a.token,fsids:JSON.stringify([Number(match[1])]),dlink:'1'}).toString();
    const meta=await baiduJSON(ep);
    const f=meta.list?.[0];
    if(!f || f.isdir===1 || !/\.(mp3|m4a|aac|wav|flac|ogg)$/i.test(f.filename||f.server_filename||f.path||'')) return makeJSON({error:'音频文件不存在或格式不支持'},404);
    if(!f.dlink) return makeJSON({error:'百度网盘没有返回下载链接，请检查账号下载权限'},403);
    const u=new URL(f.dlink);
    // Do not proxy arbitrary remote URLs. Baidu API dlinks should resolve to pcs.baidu.com hosts.
    if(u.protocol!=='https:' || !(u.hostname==='pcs.baidu.com'||u.hostname.endsWith('.pcs.baidu.com'))) return makeJSON({error:'下载链接不是允许的百度 PCS 域名'},502);
    const headers=new Headers({'User-Agent':'pan.baidu.com'});
    const range=req.headers.get('Range');if(range&&/^bytes=\d*-\d*$/.test(range))headers.set('Range',range);
    const upstream=await fetch(u.toString(),{method:req.method,headers,redirect:'follow'});
    if(!upstream.ok && upstream.status!==206) return makeJSON({error:`下载失败 (${upstream.status})；可能存在网盘限速、接口限制或会员权限`},502);
    const h=apiHeaders(a,{'Content-Type':upstream.headers.get('Content-Type')||'audio/mpeg','Accept-Ranges':'bytes','Cache-Control':'private, no-store'});
    for(const key of ['Content-Range','Content-Length','ETag'])if(upstream.headers.has(key))h.set(key,upstream.headers.get(key));
    return new Response(req.method==='HEAD'?null:upstream.body,{status:upstream.status,headers:h});
  }
  return makeJSON({error:'Not found'},404);
}
export default { async fetch(req,env) {
  try {return await handle(req,env)} catch(e) {
    return makeJSON({error:e.message||'服务器错误'},500);
  }
}};
