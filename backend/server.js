require('dotenv').config();
require('./migrate');
const express=require('express'),cookieParser=require('cookie-parser'),Database=require('better-sqlite3'),bcrypt=require('bcryptjs'),crypto=require('crypto'),multer=require('multer'),sharp=require('sharp'),nodemailer=require('nodemailer'),fs=require('fs'),path=require('path'),{v4:uuid}=require('uuid');
const {initContentDb,initReportsDb}=require('./lib/contentDb');
const {createContentRouter}=require('./routes/content');
const {createReportsRouter}=require('./routes/reports');
const {uploadErrorHandler}=require('./lib/uploads');
const app=express(),PORT=8080,now=()=>Math.floor(Date.now()/1000),DATA='/data',DBDIR=DATA+'/db',UPLOADS=DATA+'/uploads';
const users=new Database(DBDIR+'/users.db'),tags=new Database(DBDIR+'/tags.db');users.pragma('foreign_keys=ON');tags.pragma('foreign_keys=ON');
for(const p of ['avatars','mastertag_headers','media/images','media/sound','media/video'])fs.mkdirSync(path.join(UPLOADS,p),{recursive:true});
app.disable('x-powered-by');app.set('trust proxy',true);app.use(express.json({limit:'2mb'}));app.use(cookieParser());
app.use((req,res,next)=>{const origin=process.env.FRONTEND_ORIGIN||'http://localhost';res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Access-Control-Allow-Credentials','true');res.setHeader('Access-Control-Allow-Headers','Content-Type');res.setHeader('Access-Control-Allow-Methods','GET,POST,PATCH,DELETE,OPTIONS');if(req.method==='OPTIONS')return res.sendStatus(204);next()});
const clientIp=req=>{const x=req.headers['x-forwarded-for'];return x?String(x).split(',')[0].trim():req.ip||req.socket.remoteAddress||''};
const userAgent=req=>req.get('user-agent')||'';const token=()=>crypto.randomBytes(32).toString('hex');const sha=s=>crypto.createHash('sha256').update(s).digest('hex');
const userView=u=>({id:u.id,email:u.email,username:u.username,role:u.role,avatar_type:u.avatar_type,avatar_value:u.avatar_value,avatar_shape:u.avatar_shape,avatar_color:u.avatar_color,email_verified:!!u.email_verified,created_at:u.created_at});
function auth(req,res,next){const raw=req.cookies.b1tm4p_sid;if(!raw)return res.status(401).json({error:'unauthorized'});const s=users.prepare('SELECT * FROM sessions WHERE token_hash=? AND expires_at>?').get(sha(raw),now());if(!s)return res.status(401).json({error:'unauthorized'});const u=users.prepare('SELECT id,email,username,role,avatar_type,avatar_value,avatar_shape,avatar_color,email_verified,created_at FROM users WHERE id=?').get(s.user_id);if(!u)return res.status(401).json({error:'unauthorized'});req.user=u;req.sessionId=s.id;next()}
const requireRole=(...roles)=>(req,res,next)=>roles.includes(req.user.role)?next():res.status(403).json({error:'forbidden'});
const pagination=req=>({limit:Math.min(100,Math.max(1,parseInt(req.query.limit,10)||20)),offset:Math.max(0,parseInt(req.query.offset,10)||0)});
function slugify(v){const s=String(v).normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'');return s||'item'}
function uniqueMasterSlug(name,ignoreId){const base=slugify(name);let s=base,n=2;while(tags.prepare('SELECT id FROM master_tags WHERE slug=? AND id<>?').get(s,ignoreId||0))s=base+'-'+n++;return s}
function uniqueTagSlug(name,masterId,ignoreId){const base=slugify(name);let s=base,n=2;while(tags.prepare('SELECT id FROM tags WHERE master_tag_id=? AND slug=? AND id<>?').get(masterId,s,ignoreId||0))s=base+'-'+n++;return s}
function mailer(){return nodemailer.createTransport({host:process.env.SMTP_HOST,port:Number(process.env.SMTP_PORT||465),secure:String(process.env.SMTP_SECURE)==='true',auth:{user:process.env.SMTP_USER,pass:process.env.SMTP_PASS}})}
async function sendMail(to,subject,text,html){if(!process.env.SMTP_HOST||!process.env.SMTP_USER||!process.env.SMTP_PASS)return;await mailer().sendMail({from:process.env.SMTP_FROM||process.env.SMTP_USER,to,subject,text,...(html?{html}:{})})}
const baseUrl=()=>String(process.env.PUBLIC_BASE_URL||'http://localhost:8080').replace(/\/$/,'');
// Links placed INSIDE emails should point at the frontend app (which shows
// a branded landing page and then calls the API itself), never straight at
// a bare JSON API endpoint. Falls back to the API's own origin only if no
// frontend URL is configured, so emails still work in a minimal setup.
const frontendUrl=()=>String(process.env.FRONTEND_BASE_URL||process.env.FRONTEND_ORIGIN||baseUrl()).replace(/\/$/,'');
const emailEsc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
// Shared branded HTML template for every transactional email, with a styled
// button for the primary action and a plain-text fallback link underneath
// (inline CSS throughout, since that's what email clients actually render).
function emailHTML({heading,intro,buttonLabel,url,note}){
  return `<!doctype html><html><body style="margin:0;padding:0;background:#f4f4f4;font-family:Inter,Arial,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f4;padding:32px 0;">
<tr><td align="center">
<table role="presentation" width="480" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;max-width:92%;border:1px solid #e5e5e5;">
<tr><td style="background:#0c0c0c;padding:22px 28px;">
<span style="display:inline-block;width:26px;height:26px;line-height:26px;text-align:center;border:1px solid #FF7A00;border-radius:6px;color:#FF7A00;font-weight:700;font-size:15px;vertical-align:middle;">▣</span>
<span style="color:#ffffff;font-weight:700;font-size:17px;vertical-align:middle;margin-left:9px;">B1tm4p</span>
</td></tr>
<tr><td style="padding:30px 28px 10px;">
<h1 style="margin:0 0 14px;font-size:19px;color:#111;">${emailEsc(heading)}</h1>
<p style="margin:0 0 22px;font-size:14.5px;line-height:1.55;color:#444;">${intro}</p>
<table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="border-radius:8px;background:#FF7A00;">
<a href="${url}" style="display:inline-block;padding:12px 26px;font-size:14.5px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:8px;">${emailEsc(buttonLabel)}</a>
</td></tr></table>
<p style="margin:24px 0 0;font-size:12.5px;line-height:1.5;color:#999;">${note||'This link expires soon. If the button above doesn&#39;t work, copy and paste this into your browser:'}<br>
<a href="${url}" style="color:#999;word-break:break-all;">${emailEsc(url)}</a></p>
</td></tr>
<tr><td style="padding:22px 28px 26px;border-top:1px solid #efefef;">
<p style="margin:0;font-size:12px;color:#bbb;">If you didn&#39;t request this, you can safely ignore this email.</p>
</td></tr>
</table>
</td></tr>
</table>
</body></html>`;
}
function issueToken(userId,purpose,seconds){const raw=token(),t=now();users.prepare('INSERT INTO email_tokens(user_id,token_hash,purpose,expires_at,created_at) VALUES(?,?,?,?,?)').run(userId,sha(raw),purpose,t+seconds,t);return raw}
function createSession(userId,req,res){const raw=token(),t=now();users.prepare('INSERT INTO sessions(user_id,token_hash,created_at,expires_at,ip,user_agent) VALUES(?,?,?,?,?,?)').run(userId,sha(raw),t,t+30*86400,clientIp(req),userAgent(req));res.cookie('b1tm4p_sid',raw,{httpOnly:true,sameSite:'lax',secure:String(process.env.COOKIE_SECURE||'false')==='true',maxAge:30*86400*1000,path:'/'});}
function recordLogin(userId,req,success,email){users.prepare('INSERT INTO login_history(user_id,ip,user_agent,device_label,success,created_at,raw_email_attempted) VALUES(?,?,?,?,?,?,?)').run(userId||null,clientIp(req),userAgent(req),null,success?1:0,now(),email||null)}
function bootAdmin(){const email=process.env.ADMIN_EMAIL;if(!email)return;const exists=users.prepare('SELECT id FROM users WHERE email=?').get(email);if(!exists){const p=process.env.ADMIN_INITIAL_PASSWORD;if(!p)throw new Error('ADMIN_INITIAL_PASSWORD is required to create admin');users.prepare("INSERT INTO users(email,username,password_hash,role,avatar_type,avatar_value,avatar_shape,avatar_color,email_verified,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)").run(email,'admin',bcrypt.hashSync(p,10),'admin','initials','AD','square','#FF7A00',1,now())}}
bootAdmin();
function validEmail(v){return typeof v==='string'&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)}
function initialsValid(v){return typeof v==='string'&&/^[A-Z0-9]{1,2}$/.test(v)}function colorValid(v){return typeof v==='string'&&/^#[0-9A-Fa-f]{6}$/.test(v)}
const uploadMax=(Number(process.env.UPLOAD_MAX_MB)||50)*1024*1024;
const avatarUpload=multer({storage:multer.memoryStorage(),limits:{fileSize:Math.min(uploadMax,5*1024*1024)},fileFilter:(req,file,cb)=>cb(null,['image/jpeg','image/png','image/webp','image/gif'].includes(file.mimetype))});
const headerUpload=multer({storage:multer.memoryStorage(),limits:{fileSize:uploadMax},fileFilter:(req,file,cb)=>cb(null,String(file.mimetype||'').startsWith('image/'))});

app.post('/api/v1/auth/register',async(req,res)=>{const {email,username,password}=req.body||{};if(!validEmail(email)||typeof username!=='string'||!username.trim()||typeof password!=='string'||password.length<8)return res.status(400).json({error:'invalid_input'});if(users.prepare('SELECT id FROM users WHERE email=? OR username=?').get(email,username))return res.status(409).json({error:'already_exists'});const initials=(username.toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,2)||'US');const r=users.prepare("INSERT INTO users(email,username,password_hash,role,avatar_type,avatar_value,avatar_shape,avatar_color,email_verified,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)").run(email,username,bcrypt.hashSync(password,10),'user','initials',initials,'circle','#FF7A00',0,now());const t=issueToken(r.lastInsertRowid,'verify',86400);try{const u=`${frontendUrl()}/verify-email?token=${encodeURIComponent(t)}`;await sendMail(email,'Verify your B1tm4p account',`Welcome to B1tm4p! Verify your account: ${u}`,emailHTML({heading:'Verify your account',intro:`Welcome to B1tm4p, <strong>${emailEsc(username)}</strong>! Confirm this is your email address to finish setting up your account.`,buttonLabel:'Verify email',url:u}))}catch{}res.status(201).json({id:r.lastInsertRowid,email,username})});
app.get('/api/v1/auth/verify',(req,res)=>{const r=users.prepare('SELECT * FROM email_tokens WHERE token_hash=? AND purpose=? AND used=0 AND expires_at>?').get(sha(req.query.token||''),'verify',now());if(!r)return res.status(400).json({error:'invalid_token'});users.prepare('UPDATE users SET email_verified=1 WHERE id=?').run(r.user_id);users.prepare('UPDATE email_tokens SET used=1 WHERE id=?').run(r.id);res.status(200).json({ok:true})});
app.post('/api/v1/auth/login',(req,res)=>{const {email,password}=req.body||{};const u=users.prepare('SELECT * FROM users WHERE email=?').get(email||'');if(!u){recordLogin(null,req,false,email);return res.status(401).json({error:'invalid_credentials'})}if(!u.email_verified){recordLogin(u.id,req,false,email);return res.status(403).json({error:'email_not_verified'})}if(!bcrypt.compareSync(password||'',u.password_hash)){recordLogin(u.id,req,false,email);return res.status(401).json({error:'invalid_credentials'})}recordLogin(u.id,req,true,email);createSession(u.id,req,res);res.json(userView(u))});
app.post('/api/v1/auth/login-link',async(req,res)=>{const email=req.body?.email;const u=users.prepare('SELECT id,email,email_verified FROM users WHERE email=?').get(email||'');if(u&&u.email_verified){const t=issueToken(u.id,'login_link',1800);try{const url=`${frontendUrl()}/login-link?token=${encodeURIComponent(t)}`;await sendMail(u.email,'B1tm4p login link',`Log in to B1tm4p: ${url}`,emailHTML({heading:'Log in to B1tm4p',intro:'Click the button below to sign in instantly \u2014 no password needed. This link works once and expires in 30 minutes.',buttonLabel:'Log in',url}))}catch{}}res.json({ok:true})});
app.get('/api/v1/auth/login-link',(req,res)=>{const r=users.prepare('SELECT * FROM email_tokens WHERE token_hash=? AND purpose=? AND used=0 AND expires_at>?').get(sha(req.query.token||''),'login_link',now());if(!r)return res.status(400).json({error:'invalid_token'});users.prepare('UPDATE email_tokens SET used=1 WHERE id=?').run(r.id);recordLogin(r.user_id,req,true,null);createSession(r.user_id,req,res);const u=users.prepare('SELECT * FROM users WHERE id=?').get(r.user_id);res.json(userView(u))});
app.post('/api/v1/auth/logout',auth,(req,res)=>{users.prepare('DELETE FROM sessions WHERE id=?').run(req.sessionId);res.clearCookie('b1tm4p_sid',{path:'/'});res.json({ok:true})});
app.post('/api/v1/auth/password-reset-request',async(req,res)=>{const u=users.prepare('SELECT id,email FROM users WHERE email=?').get(req.body?.email||'');if(u){const t=issueToken(u.id,'password_reset',3600);try{const url=`${frontendUrl()}/reset-password?token=${encodeURIComponent(t)}`;await sendMail(u.email,'B1tm4p password reset',`Reset your B1tm4p password: ${url}`,emailHTML({heading:'Reset your password',intro:'We got a request to reset your B1tm4p password. Choose a new one below. This link expires in 1 hour.',buttonLabel:'Reset password',url}))}catch{}}res.json({ok:true})});
app.post('/api/v1/auth/password-reset',(req,res)=>{const p=req.body?.new_password;if(typeof p!=='string'||p.length<8)return res.status(400).json({error:'invalid_password'});const r=users.prepare('SELECT * FROM email_tokens WHERE token_hash=? AND purpose=? AND used=0 AND expires_at>?').get(sha(req.body?.token||''),'password_reset',now());if(!r)return res.status(400).json({error:'invalid_token'});users.prepare('UPDATE users SET password_hash=? WHERE id=?').run(bcrypt.hashSync(p,10),r.user_id);users.prepare('UPDATE email_tokens SET used=1 WHERE id=?').run(r.id);users.prepare('DELETE FROM sessions WHERE user_id=?').run(r.user_id);res.json({ok:true})});
app.get('/api/v1/me',auth,(req,res)=>res.json(userView(users.prepare('SELECT * FROM users WHERE id=?').get(req.user.id))));

// --- Google OAuth (sign-in with Google) ---
// Uses native fetch (Node 20) against Google's OAuth endpoints directly, no
// extra dependency. GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET must be set; the
// redirect/callback URL defaults to PUBLIC_BASE_URL + the callback path
// unless GOOGLE_CALLBACK_URL overrides it (e.g. if the backend is reached
// through a different public hostname than PUBLIC_BASE_URL implies).
const googleRedirectUri=()=>process.env.GOOGLE_CALLBACK_URL||`${baseUrl()}/api/v1/auth/google/callback`;
const oauthCookieOpts={httpOnly:true,sameSite:'lax',secure:String(process.env.COOKIE_SECURE||'false')==='true',maxAge:10*60*1000,path:'/api/v1/auth/google'};
app.get('/api/v1/auth/google',(req,res)=>{
  if(!process.env.GOOGLE_CLIENT_ID)return res.status(503).json({error:'google_oauth_not_configured'});
  const state=token();
  const returnTo=typeof req.query.return_to==='string'&&req.query.return_to.startsWith('/')?req.query.return_to:'/';
  res.cookie('b1tm4p_oauth_state',state,oauthCookieOpts);
  res.cookie('b1tm4p_oauth_return',encodeURIComponent(returnTo),oauthCookieOpts);
  const params=new URLSearchParams({client_id:process.env.GOOGLE_CLIENT_ID,redirect_uri:googleRedirectUri(),response_type:'code',scope:'openid email profile',state,access_type:'online',prompt:'select_account'});
  res.redirect('https://accounts.google.com/o/oauth2/v2/auth?'+params.toString());
});
app.get('/api/v1/auth/google/callback',async(req,res)=>{
  const frontend=(process.env.FRONTEND_ORIGIN||'http://localhost').replace(/\/$/,'');
  try{
    if(!process.env.GOOGLE_CLIENT_ID||!process.env.GOOGLE_CLIENT_SECRET)return res.status(503).send('Google OAuth is not configured on this server.');
    const {code,state}=req.query;
    const cookieState=req.cookies.b1tm4p_oauth_state;
    const returnTo=decodeURIComponent(req.cookies.b1tm4p_oauth_return||'/');
    res.clearCookie('b1tm4p_oauth_state',{path:'/api/v1/auth/google'});
    res.clearCookie('b1tm4p_oauth_return',{path:'/api/v1/auth/google'});
    if(!code||!state||!cookieState||state!==cookieState)return res.redirect(`${frontend}/login?error=google_oauth_failed`);
    const tokenRes=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({code,client_id:process.env.GOOGLE_CLIENT_ID,client_secret:process.env.GOOGLE_CLIENT_SECRET,redirect_uri:googleRedirectUri(),grant_type:'authorization_code'})});
    if(!tokenRes.ok)throw new Error('token_exchange_failed');
    const tokenData=await tokenRes.json();
    const profileRes=await fetch('https://www.googleapis.com/oauth2/v3/userinfo',{headers:{Authorization:'Bearer '+tokenData.access_token}});
    if(!profileRes.ok)throw new Error('userinfo_failed');
    const profile=await profileRes.json();
    if(!profile.sub||!profile.email)throw new Error('incomplete_profile');

    let u=users.prepare('SELECT * FROM users WHERE oauth_provider=? AND oauth_id=?').get('google',profile.sub);
    if(!u){
      u=users.prepare('SELECT * FROM users WHERE email=?').get(profile.email);
      if(u){
        // Existing password-based account with the same verified Google email: link it.
        users.prepare('UPDATE users SET oauth_provider=?,oauth_id=?,email_verified=1 WHERE id=?').run('google',profile.sub,u.id);
      }else{
        const base=(profile.email.split('@')[0]||'user').toLowerCase().replace(/[^a-z0-9_.-]/g,'').slice(0,20)||'user';
        let username=base,n=2;
        while(users.prepare('SELECT id FROM users WHERE username=?').get(username))username=base+(n++);
        const initials=(profile.name||profile.email).toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,2)||'US';
        const unusablePassword=bcrypt.hashSync(crypto.randomBytes(24).toString('hex'),10);
        const info=users.prepare("INSERT INTO users(email,username,password_hash,role,avatar_type,avatar_value,avatar_shape,avatar_color,email_verified,created_at,oauth_provider,oauth_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)").run(profile.email,username,unusablePassword,'user','initials',initials,'circle','#FF7A00',profile.email_verified?1:0,now(),'google',profile.sub);
        u=users.prepare('SELECT * FROM users WHERE id=?').get(info.lastInsertRowid);
      }
    }
    recordLogin(u.id,req,true,profile.email);
    createSession(u.id,req,res);
    res.redirect(frontend+returnTo);
  }catch(e){
    console.error('google oauth callback failed',e);
    res.redirect(`${frontend}/login?error=google_oauth_failed`);
  }
});

app.patch('/api/v1/account',auth,async(req,res)=>{const u=users.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);const {username,email}=req.body||{};if(username===undefined&&email===undefined)return res.status(400).json({error:'no_changes'});try{if(username!==undefined){if(typeof username!=='string'||!username.trim())return res.status(400).json({error:'invalid_username'});users.prepare('UPDATE users SET username=? WHERE id=?').run(username.trim(),u.id)}if(email!==undefined){if(!validEmail(email))return res.status(400).json({error:'invalid_email'});if(email!==u.email){users.prepare('UPDATE users SET email=?,email_verified=0 WHERE id=?').run(email,u.id);const t=issueToken(u.id,'verify',86400);try{const url=`${frontendUrl()}/verify-email?token=${encodeURIComponent(t)}`;await sendMail(email,'Verify your new B1tm4p email',`Confirm your new email address: ${url}`,emailHTML({heading:'Confirm your new email',intro:`You asked to change your B1tm4p account email to this address. Confirm it\u2019s really you.`,buttonLabel:'Verify email',url}))}catch{}}}res.json(userView(users.prepare('SELECT * FROM users WHERE id=?').get(u.id)))}catch(e){if(String(e.message).includes('UNIQUE'))return res.status(409).json({error:'already_exists'});res.status(500).json({error:'internal_error'})}});
app.patch('/api/v1/account/password',auth,(req,res)=>{const u=users.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);if(!bcrypt.compareSync(req.body?.current_password||'',u.password_hash))return res.status(403).json({error:'current_password_incorrect'});if(typeof req.body?.new_password!=='string'||req.body.new_password.length<8)return res.status(400).json({error:'invalid_password'});users.prepare('UPDATE users SET password_hash=? WHERE id=?').run(bcrypt.hashSync(req.body.new_password,10),u.id);users.prepare('DELETE FROM sessions WHERE user_id=? AND id<>?').run(u.id,req.sessionId);res.json({ok:true})});
app.patch('/api/v1/account/avatar',auth,(req,res)=>{const current=users.prepare('SELECT role FROM users WHERE id=?').get(req.user.id);const {avatar_type,avatar_value,avatar_shape,avatar_color}=req.body||{};if(!['image','initials'].includes(avatar_type))return res.status(400).json({error:'invalid_avatar_type'});if(avatar_type==='initials'&&!initialsValid(avatar_value))return res.status(400).json({error:'invalid_avatar_value'});if(!['circle','square'].includes(avatar_shape))return res.status(400).json({error:'invalid_avatar_shape'});if(avatar_shape==='square'&&!['admin','manager'].includes(current.role))return res.status(403).json({error:'square avatars reserved for staff'});if(!colorValid(avatar_color))return res.status(400).json({error:'invalid_avatar_color'});const old=users.prepare('SELECT avatar_type,avatar_value FROM users WHERE id=?').get(req.user.id);users.prepare('UPDATE users SET avatar_type=?,avatar_value=?,avatar_shape=?,avatar_color=? WHERE id=?').run(avatar_type,avatar_value,avatar_shape,avatar_color,req.user.id);if(avatar_type==='initials'&&old.avatar_type==='image'&&old.avatar_value.startsWith('/uploads/avatars/')){const f=path.join(DATA,old.avatar_value.replace(/^\//,''));try{fs.unlinkSync(f)}catch{}}res.json(userView(users.prepare('SELECT * FROM users WHERE id=?').get(req.user.id)))});
app.post('/api/v1/account/avatar/upload',auth,avatarUpload.single('avatar'),async(req,res)=>{if(!req.file)return res.status(400).json({error:'invalid_image'});try{const old=users.prepare('SELECT avatar_type,avatar_value FROM users WHERE id=?').get(req.user.id);const rel=`/uploads/avatars/${req.user.id}_${Date.now()}.webp`;await sharp(req.file.buffer).resize(256,256,{fit:'cover'}).webp().toFile(path.join(DATA,rel.slice(1)));users.prepare('UPDATE users SET avatar_type=\'image\',avatar_value=? WHERE id=?').run(rel,req.user.id);if(old.avatar_type==='image'&&old.avatar_value.startsWith('/uploads/avatars/')){try{fs.unlinkSync(path.join(DATA,old.avatar_value.slice(1)))}catch{}}res.json(userView(users.prepare('SELECT * FROM users WHERE id=?').get(req.user.id)))}catch{return res.status(400).json({error:'invalid_image'})}});

app.get('/api/v1/tags/master',(req,res)=>{const {limit,offset}=pagination(req);res.json({items:tags.prepare('SELECT * FROM master_tags ORDER BY id DESC LIMIT ? OFFSET ?').all(limit,offset),total:tags.prepare('SELECT COUNT(*) n FROM master_tags').get().n})});
app.get('/api/v1/tags/master/:slug',(req,res)=>{const m=tags.prepare('SELECT * FROM master_tags WHERE slug=?').get(req.params.slug);if(!m)return res.status(404).json({error:'not_found'});res.json({...m,tags:tags.prepare('SELECT * FROM tags WHERE master_tag_id=? ORDER BY id').all(m.id)})});
app.get('/api/v1/tags',(req,res)=>{const {limit,offset}=pagination(req);let m=null;if(req.query.master_slug){m=tags.prepare('SELECT id FROM master_tags WHERE slug=?').get(req.query.master_slug);if(!m)return res.json({items:[],total:0})}const items=m?tags.prepare('SELECT * FROM tags WHERE master_tag_id=? ORDER BY id DESC LIMIT ? OFFSET ?').all(m.id,limit,offset):tags.prepare('SELECT * FROM tags ORDER BY id DESC LIMIT ? OFFSET ?').all(limit,offset);const total=m?tags.prepare('SELECT COUNT(*) n FROM tags WHERE master_tag_id=?').get(m.id).n:tags.prepare('SELECT COUNT(*) n FROM tags').get().n;res.json({items,total})});
app.post('/api/v1/tag-requests',auth,requireRole('support','manager','admin'),(req,res)=>{const {request_type,proposed_name,parent_master_tag_id}=req.body||{};if(!['master_tag','tag'].includes(request_type)||typeof proposed_name!=='string'||!proposed_name.trim())return res.status(400).json({error:'invalid_input'});if(request_type==='tag'&&(!Number.isInteger(parent_master_tag_id)||!tags.prepare('SELECT id FROM master_tags WHERE id=?').get(parent_master_tag_id)))return res.status(400).json({error:'parent_master_tag_required'});const r=tags.prepare('INSERT INTO tag_requests(request_type,proposed_name,parent_master_tag_id,requested_by,status,created_at) VALUES(?,?,?,?,?,?)').run(request_type,proposed_name.trim(),parent_master_tag_id||null,req.user.id,'pending',now());res.status(201).json(tags.prepare('SELECT * FROM tag_requests WHERE id=?').get(r.lastInsertRowid))});
app.get('/api/v1/tag-requests',auth,requireRole('manager','admin'),(req,res)=>{const {limit,offset}=pagination(req),status=req.query.status||'pending';if(!['pending','approved','rejected'].includes(status))return res.status(400).json({error:'invalid_status'});res.json({items:tags.prepare('SELECT * FROM tag_requests WHERE status=? ORDER BY id DESC LIMIT ? OFFSET ?').all(status,limit,offset),total:tags.prepare('SELECT COUNT(*) n FROM tag_requests WHERE status=?').get(status).n})});
function reviewRequest(req,res,approve){const r=tags.prepare('SELECT * FROM tag_requests WHERE id=?').get(req.params.id);if(!r)return res.status(404).json({error:'not_found'});if(r.status!=='pending')return res.status(409).json({error:'already_reviewed'});try{if(approve){if(r.request_type==='master_tag'){const s=uniqueMasterSlug(r.proposed_name);tags.prepare('INSERT INTO master_tags(name,slug,created_by,created_at,updated_at) VALUES(?,?,?,?,?)').run(r.proposed_name,s,r.requested_by,now(),now())}else{const s=uniqueTagSlug(r.proposed_name,r.parent_master_tag_id);tags.prepare('INSERT INTO tags(master_tag_id,name,slug,created_by,created_at) VALUES(?,?,?,?,?)').run(r.parent_master_tag_id,r.proposed_name,s,r.requested_by,now())}}tags.prepare('UPDATE tag_requests SET status=?,reviewed_by=?,review_note=?,reviewed_at=? WHERE id=?').run(approve?'approved':'rejected',req.user.id,req.body?.review_note||null,now(),r.id);res.json(tags.prepare('SELECT * FROM tag_requests WHERE id=?').get(r.id))}catch(e){res.status(409).json({error:'conflict'})}}
app.post('/api/v1/tag-requests/:id/approve',auth,requireRole('manager','admin'),(req,res)=>reviewRequest(req,res,true));app.post('/api/v1/tag-requests/:id/reject',auth,requireRole('manager','admin'),(req,res)=>reviewRequest(req,res,false));
app.post('/api/v1/tags/master',auth,requireRole('manager','admin'),(req,res)=>{const {name,description}=req.body||{};if(typeof name!=='string'||!name.trim())return res.status(400).json({error:'invalid_input'});try{const s=uniqueMasterSlug(name);const r=tags.prepare('INSERT INTO master_tags(name,slug,description,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?)').run(name.trim(),s,description??null,req.user.id,now(),now());res.status(201).json(tags.prepare('SELECT * FROM master_tags WHERE id=?').get(r.lastInsertRowid))}catch{return res.status(409).json({error:'conflict'})}});
app.post('/api/v1/tags',auth,requireRole('manager','admin'),(req,res)=>{const {master_tag_id,name}=req.body||{};if(!Number.isInteger(master_tag_id)||typeof name!=='string'||!name.trim()||!tags.prepare('SELECT id FROM master_tags WHERE id=?').get(master_tag_id))return res.status(400).json({error:'invalid_input'});try{const s=uniqueTagSlug(name,master_tag_id);const r=tags.prepare('INSERT INTO tags(master_tag_id,name,slug,created_by,created_at) VALUES(?,?,?,?,?)').run(master_tag_id,name.trim(),s,req.user.id,now());res.status(201).json(tags.prepare('SELECT * FROM tags WHERE id=?').get(r.lastInsertRowid))}catch{return res.status(409).json({error:'conflict'})}});
app.patch('/api/v1/tags/master/:id',auth,requireRole('manager','admin'),(req,res)=>{const m=tags.prepare('SELECT * FROM master_tags WHERE id=?').get(req.params.id);if(!m)return res.status(404).json({error:'not_found'});if(req.body?.name===undefined&&req.body?.description===undefined)return res.status(400).json({error:'no_changes'});const name=req.body.name===undefined?m.name:String(req.body.name);if(!name.trim())return res.status(400).json({error:'invalid_name'});try{tags.prepare('UPDATE master_tags SET name=?,slug=?,description=?,updated_at=? WHERE id=?').run(name.trim(),uniqueMasterSlug(name,m.id),req.body.description===undefined?m.description:req.body.description,now(),m.id);res.json(tags.prepare('SELECT * FROM master_tags WHERE id=?').get(m.id))}catch{return res.status(409).json({error:'conflict'})}});
app.delete('/api/v1/tags/master/:id',auth,requireRole('manager','admin'),(req,res)=>{const m=tags.prepare('SELECT id FROM master_tags WHERE id=?').get(req.params.id);if(!m)return res.status(404).json({error:'not_found'});const count=tags.prepare('SELECT COUNT(*) n FROM tags WHERE master_tag_id=?').get(m.id).n;if(count&&!req.query.force)return res.status(409).json({error:'master_has_tags'});tags.transaction(()=>{if(req.query.force==='true')tags.prepare('DELETE FROM tags WHERE master_tag_id=?').run(m.id);tags.prepare('DELETE FROM master_tags WHERE id=?').run(m.id)})();res.json({ok:true})});
app.patch('/api/v1/tags/:id',auth,requireRole('manager','admin'),(req,res)=>{const t=tags.prepare('SELECT * FROM tags WHERE id=?').get(req.params.id);if(!t)return res.status(404).json({error:'not_found'});if(req.body?.name===undefined)return res.status(400).json({error:'no_changes'});const name=String(req.body.name);if(!name.trim())return res.status(400).json({error:'invalid_name'});try{tags.prepare('UPDATE tags SET name=?,slug=? WHERE id=?').run(name.trim(),uniqueTagSlug(name,t.master_tag_id,t.id),t.id);res.json(tags.prepare('SELECT * FROM tags WHERE id=?').get(t.id))}catch{return res.status(409).json({error:'conflict'})}});
app.delete('/api/v1/tags/:id',auth,requireRole('manager','admin'),(req,res)=>{if(!tags.prepare('SELECT id FROM tags WHERE id=?').get(req.params.id))return res.status(404).json({error:'not_found'});tags.prepare('DELETE FROM tags WHERE id=?').run(req.params.id);res.json({ok:true})});
app.post('/api/v1/tags/master/:id/header',auth,requireRole('manager','admin'),headerUpload.single('header'),async(req,res)=>{if(!tags.prepare('SELECT id FROM master_tags WHERE id=?').get(req.params.id))return res.status(404).json({error:'not_found'});if(!req.file)return res.status(400).json({error:'invalid_image'});const filename=uuid()+'.'+(req.file.mimetype.split('/')[1]||'img').replace(/[^a-z0-9]/gi,'');const rel='/uploads/mastertag_headers/'+filename;try{await sharp(req.file.buffer).metadata();fs.writeFileSync(path.join(DATA,rel.slice(1)),req.file.buffer)}catch{return res.status(400).json({error:'invalid_image'})}tags.prepare('UPDATE master_tags SET header_image_path=?,updated_at=? WHERE id=?').run(rel,now(),req.params.id);res.json({header_image_path:rel})});

app.get('/api/v1/admin/users',auth,requireRole('admin'),(req,res)=>{const {limit,offset}=pagination(req);res.json({items:users.prepare('SELECT id,email,username,role,created_at FROM users ORDER BY id LIMIT ? OFFSET ?').all(limit,offset),total:users.prepare('SELECT COUNT(*) n FROM users').get().n})});
app.patch('/api/v1/admin/users/:id/role',auth,requireRole('admin'),(req,res)=>{if(!['user','support','manager','admin'].includes(req.body?.role))return res.status(400).json({error:'invalid_role'});if(!users.prepare('SELECT id FROM users WHERE id=?').get(req.params.id))return res.status(404).json({error:'not_found'});users.prepare('UPDATE users SET role=? WHERE id=?').run(req.body.role,req.params.id);res.json({id:Number(req.params.id),role:req.body.role})});
function optionalCounts(){const out={likes:{},reports:{}};try{const db=new Database(DBDIR+'/content.db',{readonly:true,fileMustExist:true});for(const r of db.prepare('SELECT user_id,COUNT(*) n FROM likes GROUP BY user_id').all())out.likes[r.user_id]=r.n;db.close()}catch{}try{const db=new Database(DBDIR+'/reports.db',{readonly:true,fileMustExist:true});for(const r of db.prepare('SELECT user_id,COUNT(*) n FROM reports GROUP BY user_id').all())out.reports[r.user_id]=r.n;db.close()}catch{}return out}
function esc(v){return String(v??'').replace(/[&<>\"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[c]))}
app.get('/admin-raw',auth,(req,res)=>{if(req.user.role!=='admin')return res.redirect('/');const usersList=users.prepare('SELECT id,email,username,role,created_at FROM users ORDER BY id').all();const lh=users.prepare('SELECT l.*,u.email FROM login_history l LEFT JOIN users u ON u.id=l.user_id ORDER BY l.id DESC').all();const ss=users.prepare('SELECT s.*,u.email FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.expires_at>? ORDER BY s.id DESC').all(now());const counts=optionalCounts();const table=(arr,headers)=>`<table><tr>${headers.map(h=>`<th>${esc(h)}</th>`).join('')}</tr>${arr.map(r=>`<tr>${headers.map(h=>`<td>${esc(r[h])}</td>`).join('')}</tr>`).join('')}</table>`;res.type('html').send(`<!doctype html><html><body><h1>B1tm4p admin</h1><h2>Users</h2>${table(usersList,['id','email','username','role','created_at'])}<h2>Login history</h2>${table(lh,['id','user_id','email','ip','user_agent','device_label','success','created_at','raw_email_attempted'])}<h2>Active sessions</h2>${table(ss,['id','user_id','email','created_at','expires_at','ip','user_agent'])}<h2>Likes/reports</h2><table><tr><th>user_id</th><th>email</th><th>likes</th><th>reports</th></tr>${usersList.map(u=>`<tr><td>${u.id}</td><td>${esc(u.email)}</td><td>${counts.likes[u.id]||0}</td><td>${counts.reports[u.id]||0}</td></tr>`).join('')}</table><!-- likes/reports data populated by content service, joined here by reading content.db and reports.db directly with a separate better-sqlite3 connection opened read-only --></body></html>`) });
const contentDb=initContentDb();
const reportsDb=initReportsDb();
app.use('/uploads/avatars',express.static('/data/uploads/avatars',{fallthrough:false,index:false,dotfiles:'deny',maxAge:'1h'}));
app.use('/uploads/mastertag_headers',express.static('/data/uploads/mastertag_headers',{fallthrough:false,index:false,dotfiles:'deny',maxAge:'1h'}));
app.use('/uploads/media',express.static('/data/uploads/media',{fallthrough:false,index:false,dotfiles:'deny',maxAge:'1h'}));
app.use('/api/v1',createContentRouter({contentDb}));
app.use('/api/v1',createReportsRouter({contentDb,reportsDb}));
app.use(uploadErrorHandler);
app.use((err,req,res,next)=>{if(err instanceof multer.MulterError)return res.status(400).json({error:'upload_error'});if(err)console.error(err);res.status(500).json({error:'internal_error'})});
app.listen(PORT,'0.0.0.0',()=>console.log('B1tm4p backend listening on 8080'));