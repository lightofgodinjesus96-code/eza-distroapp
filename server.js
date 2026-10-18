/* ============================================================
   EZA DISTROAPP — Backend Server (zero dependencies, Node 18+)
   Founder/Admin: HB pEza <hbpeza@gmail.com>
   ============================================================ */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const PUB = path.join(ROOT, 'public');
const UPLOADS = path.join(ROOT, 'data', 'uploads');
const DB_FILE = path.join(ROOT, 'data', 'db.json');
fs.mkdirSync(UPLOADS, { recursive: true });

/* ---------- secret (persisted so sessions survive restarts) ---------- */
const SECRET_FILE = path.join(ROOT, 'data', 'secret');
let SECRET;
if (fs.existsSync(SECRET_FILE)) SECRET = fs.readFileSync(SECRET_FILE, 'utf8');
else { SECRET = crypto.randomBytes(32).toString('hex'); fs.writeFileSync(SECRET_FILE, SECRET); }

/* ---------- database ---------- */
function loadDB() { try { return JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); } catch (e) { return { users: [], releases: [] }; } }
let db = loadDB();
function saveDB() { fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 1)); }

const now = () => Date.now();
const uid = () => crypto.randomBytes(8).toString('hex');

function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(pw, salt, 64).toString('hex');
  return salt + ':' + hash;
}
function checkPassword(pw, stored) {
  const [salt, hash] = stored.split(':');
  const test = crypto.scryptSync(pw, salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(test, 'hex'));
}

/* ---------- auth tokens ---------- */
const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
const sign = p => crypto.createHmac('sha256', SECRET).update(p).digest('base64url');
function makeToken(user) { const p = b64({ uid: user.id, exp: now() + 30 * 86400e3 }); return p + '.' + sign(p); }
function verifyToken(tok) {
  if (!tok) return null;
  const [p, s] = tok.split('.');
  if (!p || sign(p) !== s) return null;
  try { const o = JSON.parse(Buffer.from(p, 'base64url').toString()); if (o.exp < now()) return null; return db.users.find(u => u.id === o.uid) || null; } catch (e) { return null; }
}

/* ---------- plans ---------- */
const PLANS = {
  free: { id: 'free', name: 'Free Plan', price: 0, upfront: 0, commission: 0.15, blurb: 'Pay nothing to upload. EZA keeps 15% of your earnings.' },
  pro:  { id: 'pro', name: 'EZA Pro', price: 19.99, upfront: 1, commission: 0.0, blurb: '$19.99/year. Keep 100% of everything you earn.' },
};
const ADMIN_EMAIL = 'hbpeza@gmail.com';

/* seed admin account */
if (!db.users.some(u => u.email === ADMIN_EMAIL)) {
  db.users.push({
    id: uid(), name: 'HB pEza', email: ADMIN_EMAIL, role: 'admin', plan: 'pro',
    passHash: hashPassword(process.env.ADMIN_PASSWORD || 'HBpeza@2026'),
    artist: 'HB pEza', joined: now(), bank: null,
  });
  saveDB();
  console.log('[EZA] Admin seeded: hbpeza@gmail.com / ' + (process.env.ADMIN_PASSWORD || 'HBpeza@2026'));
}

/* ---------- stores + distribution engine ---------- */
const STORES = [
  { id: 'spotify', name: 'Spotify', icon: '🟢' }, { id: 'apple', name: 'Apple Music', icon: '🍎' },
  { id: 'ytmusic', name: 'YouTube Music', icon: '▶️' }, { id: 'tiktok', name: 'TikTok', icon: '🎵' },
  { id: 'amazon', name: 'Amazon Music', icon: '📦' }, { id: 'deezer', name: 'Deezer', icon: '🐬' },
  { id: 'tidal', name: 'TIDAL', icon: '🌊' }, { id: 'ig', name: 'Instagram / FB', icon: '📸' },
  { id: 'pandora', name: 'Pandora', icon: '📻' }, { id: 'napster', name: 'Napster', icon: '🎧' },
];
const REVIEW_MS = 2 * 60e3;         // default review time (admin approval makes it instant)
const STAGGER_MS = 25e3;            // per-store go-live stagger
const RATE = 0.004;                 // avg $/stream
const DAY = 86400e3;

function storeStatuses(rel) {
  if (rel.status === 'rejected') return rel.stores.map(s => ({ store: s, state: 'rejected' }));
  if (rel.status === 'taken_down') return rel.stores.map(s => ({ store: s, state: 'taken_down' }));
  const t = now();
  return rel.stores.map((s, i) => {
    const liveAt = rel.reviewEndsAt + STAGGER_MS * i;
    return { store: s, state: t < rel.reviewEndsAt ? 'in_review' : (t >= liveAt ? 'live' : 'delivering'), liveAt };
  });
}

/* deterministic royalty simulation */
function prng(seed) { let s = seed; return () => { s = (s * 9301 + 49297) % 233280; return s / 233280; }; }
function streamsFor(rel, daysAgo) {
  const ageDays = Math.floor((now() - rel.submittedAt) / DAY);
  if (daysAgo > ageDays || rel.status === 'rejected' || rel.status === 'taken_down') return 0;
  const rnd = prng(rel.seed + daysAgo * 7);
  const growth = Math.max(.12, 1 - daysAgo / (ageDays + 3));
  return Math.floor(rel.baseStreams * rel.hype * growth * (0.55 + rnd()));
}
function releaseEarnings(rel) {
  const plan = PLANS[rel.planOwner] || PLANS.free;
  let gross = 0, streams = 0;
  for (let d = 0; d < 365; d++) { const s = streamsFor(rel, d); streams += s; gross += s * RATE; }
  const fee = gross * plan.commission;
  return { gross, fee, net: gross - fee, streams, rate: RATE, commissionPct: plan.commission * 100 };
}

/* ---------- helpers ---------- */
function send(res, code, obj) { const b = JSON.stringify(obj); res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(b); }
function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if (size > 200e6) { reject(new Error('too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString() || '{}')); } catch (e) { resolve({}); } });
    req.on('error', reject);
  });
}
const pubUser = u => ({ id: u.id, name: u.name, artist: u.artist, email: u.email, role: u.role, plan: u.plan, joined: u.joined, bank: u.bank });
const pubRelease = r => {
  const st = storeStatuses(r);
  return {
    id: r.id, title: r.title, artistName: r.artistName, genre: r.genre, releaseDate: r.releaseDate,
    explicit: r.explicit, language: r.language, artUrl: r.artUrl, tracks: r.tracks.map(t => ({ name: t.name, url: t.url, size: t.size })),
    stores: r.stores, splits: r.splits, status: r.status, planOwner: r.planOwner,
    submittedAt: r.submittedAt, storeStatuses: st, liveCount: st.filter(x => x.state === 'live').length,
    earnings: releaseEarnings(r), ownerId: r.ownerId,
  };
};

/* ---------- router ---------- */
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;

  /* ===== API ===== */
  if (p.startsWith('/api/')) {
    try {
      const auth = verifyToken((req.headers.authorization || '').replace('Bearer ', ''));

      /* --- auth --- */
      if (p === '/api/auth/signup' && req.method === 'POST') {
        const { name, email, password, plan } = await readBody(req);
        if (!name || !/^\S+@\S+\.\S+$/.test(email || '') || (password || '').length < 6)
          return send(res, 400, { error: 'Name, valid email and password (6+ chars) required.' });
        if (email.toLowerCase() === ADMIN_EMAIL) return send(res, 403, { error: 'This email is reserved for the platform admin.' });
        if (db.users.some(u => u.email === email.toLowerCase())) return send(res, 409, { error: 'An account with this email already exists.' });
        const user = { id: uid(), name, artist: name, email: email.toLowerCase(), role: 'artist', plan: PLANS[plan] ? plan : 'free', passHash: hashPassword(password), joined: now(), bank: null };
        db.users.push(user); saveDB();
        return send(res, 200, { token: makeToken(user), user: pubUser(user) });
      }
      if (p === '/api/auth/login' && req.method === 'POST') {
        const { email, password } = await readBody(req);
        const user = db.users.find(u => u.email === (email || '').toLowerCase());
        if (!user || !checkPassword(password || '', user.passHash)) return send(res, 401, { error: 'Invalid email or password.' });
        return send(res, 200, { token: makeToken(user), user: pubUser(user) });
      }
      if (p === '/api/me' && req.method === 'GET') {
        if (!auth) return send(res, 401, { error: 'Not logged in.' });
        return send(res, 200, { user: pubUser(auth), plan: PLANS[auth.plan] });
      }
      if (p === '/api/me' && req.method === 'PUT') {
        if (!auth) return send(res, 401, { error: 'Not logged in.' });
        const b = await readBody(req);
        if (b.artist) auth.artist = String(b.artist).slice(0, 80);
        if (b.name) auth.name = String(b.name).slice(0, 80);
        if (b.bank) auth.bank = { holder: String(b.bank.holder || ''), route: String(b.bank.route || ''), acct: String(b.bank.acct || '') };
        if (b.plan && PLANS[b.plan] && auth.role !== 'admin') auth.plan = b.plan;
        saveDB();
        return send(res, 200, { user: pubUser(auth) });
      }

      /* --- releases --- */
      if (p === '/api/releases' && req.method === 'POST') {
        if (!auth) return send(res, 401, { error: 'Not logged in.' });
        const b = await readBody(req);
        if (!b.title || !b.artistName || !b.genre || !b.releaseDate || !Array.isArray(b.stores) || !b.stores.length)
          return send(res, 400, { error: 'Title, artist, genre, release date and at least one store are required.' });
        let artUrl = null;
        if (b.artData) {
          const m = /^data:image\/(png|jpe?g|webp);base64,(.+)$/.exec(b.artData);
          if (!m) return send(res, 400, { error: 'Artwork must be a PNG/JPG image.' });
          const fname = 'art_' + uid() + '.' + (m[1] === 'jpeg' ? 'jpg' : m[1]);
          fs.writeFileSync(path.join(UPLOADS, fname), Buffer.from(m[2], 'base64'));
          artUrl = '/uploads/' + fname;
        }
        const seed = parseInt(crypto.createHash('md5').update(auth.id + b.title).digest('hex').slice(0, 8), 16) % 99991;
        const rel = {
          id: uid(), ownerId: auth.id, ownerEmail: auth.email, planOwner: auth.plan,
          title: String(b.title).slice(0, 120), artistName: String(b.artistName).slice(0, 120),
          genre: b.genre, releaseDate: b.releaseDate, explicit: !!b.explicit, language: b.language || 'English',
          artUrl, tracks: [], stores: b.stores.filter(s => STORES.some(x => x.id === s)),
          splits: [{ name: auth.artist, email: auth.email, percent: 100 }],
          status: 'in_review', submittedAt: now(), reviewEndsAt: now() + REVIEW_MS,
          baseStreams: 60 + Math.floor(Math.random() * 900), hype: 0.5 + Math.random() * 1.5, seed,
        };
        db.releases.push(rel); saveDB();
        return send(res, 200, { release: pubRelease(rel) });
      }
      if (p === '/api/releases' && req.method === 'GET') {
        if (!auth) return send(res, 401, { error: 'Not logged in.' });
        let list = auth.role === 'admin' && url.searchParams.get('all') === '1' ? db.releases : db.releases.filter(r => r.ownerId === auth.id);
        return send(res, 200, { releases: list.map(pubRelease).sort((a, b) => b.submittedAt - a.submittedAt), stores: STORES, plans: PLANS });
      }
      let m;
      if ((m = p.match(/^\/api\/releases\/([\w]+)\/tracks$/)) && req.method === 'POST') {
        if (!auth) return send(res, 401, { error: 'Not logged in.' });
        const rel = db.releases.find(r => r.id === m[1]);
        if (!rel || (rel.ownerId !== auth.id && auth.role !== 'admin')) return send(res, 403, { error: 'Not allowed.' });
        const b = await readBody(req);
        const dm = /^data:audio\/(mpeg|wav|x-wav|flac|mp4|aac|ogg);base64,(.+)$/.exec(b.data || '');
        if (!dm) return send(res, 400, { error: 'Audio must be MP3/WAV/FLAC.' });
        const buf = Buffer.from(dm[2], 'base64');
        if (buf.length > 60e6) return send(res, 400, { error: 'Max track size 60MB.' });
        const fname = 'trk_' + uid() + '.' + dm[1].replace('x-wav', 'wav');
        fs.writeFileSync(path.join(UPLOADS, fname), buf);
        const track = { name: String(b.name || 'Track ' + (rel.tracks.length + 1)).slice(0, 160), url: '/uploads/' + fname, size: buf.length };
        rel.tracks.push(track); saveDB();
        return send(res, 200, { track });
      }
      if ((m = p.match(/^\/api\/releases\/([\w]+)\/splits$/)) && req.method === 'PUT') {
        if (!auth) return send(res, 401, { error: 'Not logged in.' });
        const rel = db.releases.find(r => r.id === m[1]);
        if (!rel || (rel.ownerId !== auth.id && auth.role !== 'admin')) return send(res, 403, { error: 'Not allowed.' });
        const b = await readBody(req);
        const splits = (b.splits || []).map(s => ({ name: String(s.name).slice(0, 80), email: String(s.email || '').slice(0, 120), percent: Math.max(0, Math.min(100, parseInt(s.percent) || 0)) }));
        if (!splits.length || splits.reduce((n, s) => n + s.percent, 0) !== 100)
          return send(res, 400, { error: 'Splits must total exactly 100%.' });
        rel.splits = splits; saveDB();
        return send(res, 200, { release: pubRelease(rel) });
      }

      /* --- admin --- */
      if (p === '/api/admin/stats' && req.method === 'GET') {
        if (!auth || auth.role !== 'admin') return send(res, 403, { error: 'Admin only.' });
        let gross = 0, fee = 0, streams = 0;
        db.releases.forEach(r => { const e = releaseEarnings(r); gross += e.gross; fee += e.fee; streams += e.streams; });
        return send(res, 200, {
          users: db.users.filter(u => u.role !== 'admin').length,
          releases: db.releases.length, live: db.releases.filter(r => storeStatuses(r).some(s => s.state === 'live')).length,
          gross, platformFees: fee, streams, proUsers: db.users.filter(u => u.plan === 'pro').length,
        });
      }
      if ((m = p.match(/^\/api\/admin\/releases\/([\w]+)\/decision$/)) && req.method === 'POST') {
        if (!auth || auth.role !== 'admin') return send(res, 403, { error: 'Admin only.' });
        const rel = db.releases.find(r => r.id === m[1]);
        if (!rel) return send(res, 404, { error: 'Release not found.' });
        const { action } = await readBody(req);
        if (action === 'approve') { rel.status = 'in_review'; rel.reviewEndsAt = now(); }
        else if (action === 'reject') rel.status = 'rejected';
        else if (action === 'restore') { rel.status = 'in_review'; rel.reviewEndsAt = now(); }
        else if (action === 'takedown') rel.status = 'taken_down';
        else return send(res, 400, { error: 'Unknown action.' });
        saveDB();
        return send(res, 200, { release: pubRelease(rel) });
      }
      return send(res, 404, { error: 'Unknown endpoint.' });
    } catch (e) { console.error(e); return send(res, 500, { error: 'Server error: ' + e.message }); }
  }

  /* ===== static files ===== */
  let file = p === '/' ? '/index.html' : p;
  if (file.startsWith('/uploads/')) file = '/../data/uploads/' + path.basename(file);
  const full = path.join(__dirname, file.startsWith('/') ? file.slice(1) : file);
  if (!full.startsWith(path.normalize(PUB)) && !full.startsWith(UPLOADS)) { res.writeHead(403); return res.end(); }
  fs.readFile(full, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    const ext = path.extname(full).toLowerCase();
    const ct = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.flac': 'audio/flac', '.ogg': 'audio/ogg', '.m4a': 'audio/mp4' }[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': ct }); res.end(data);
  });
});

// Wrap listen so it only runs locally, not on Vercel serverless
if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
  });
}

// Export the app for Vercel
module.exports = app;

  
