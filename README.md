⚡ EZA DISTROAPP

Music distribution platform — founded by artist HB pEza

A complete full-stack music distributor: real backend server, database, artist accounts,
upload pipeline, distribution tracking, royalties with plan-based commission, revenue splits,
payouts, and a full admin control panel for you.

▶️ How to run

```bash
cd ezadistroapp
node server.js
```

Then open http://localhost:3000 in your browser. That's it — zero npm installs needed.

🔑 Your Admin account (only for you)

		
Email	`hbpeza@gmail.com`	
Password	`HBpeza@2026` (change it via env: `ADMIN_PASSWORD=YourPass node server.js`)	

When you log in as admin you get the 🛡️ Admin Panel: view every signed-up artist,
every release, approve releases (goes live instantly), reject, or takedown — plus platform
stats including your 15% commission earnings from Free-plan artists.

👥 For your clients/artists
They sign up themselves, pick a plan, upload releases (artwork + multi-track audio),
watch distribution go live across 10 stores, track earnings, set collaborator splits,
and add payout details.

💰 The two plans ("before uploading / after selling")

Plan	Upfront	Commission	
FREE PLAN	0	EZA keeps 15% of earnings	
EZA PRO	19.99/yr	0% — artist keeps 100%	

Artists choose the plan before uploading; commission applies automatically after they sell.

🆕 Custom release tools
- Custom UPC/EAN codes — enter your own 12-13 digit code, or leave blank and EZA auto-assigns a valid EAN-13 (check digit validated server-side, bad codes rejected)
- Per-track ISRC codes — enter `CC-XXX-YY-NNNNN` per track or auto-assign (auto codes are minted under registrant `QZ-HBP`)
- Custom record label name on every release
- YouTube Content ID opt-in (EZA PRO feature — server-enforced; free-plan artists can't enable it)
- Edit release while it's still in review (metadata, stores, artwork)
- Duplicate release — clone a release into a new upload (copies art + metadata, you re-attach audio)
- Artist takedown — remove your release from all stores yourself, anytime
- UPC, label, Content ID status, and full tracklist/ISRC codes visible on every release (with ▶ play links to the stored audio)

🚀 Full platform feature set
Artist side
- 🎤 Multi-artist profiles — manage up to 5 artist names from one account (Free: 1, PRO: 5); pick the profile per release
- 🔗 Smart link pages (`/#/r/<id>`) — public pre-save page with live countdown to release day; fans pre-save with email; once live, buttons link straight to every store
- 🔔 Notifications bell — you're alerted when your release goes live, hits pre-save milestones (10, 20, 30…), gets rejected/taken down, or Content ID changes
- 📄 Per-release analytics page — daily streams chart, gross/commission/net, per-store live status, pre-save count, splits, copyable smart link
- 🔒 Change password (verifies current password)
- Everything from before: custom UPC/EAN, per-track ISRC, custom label, Content ID, edit/duplicate/takedown, earnings, splits, payouts

Admin side (HB pEza)
- 📊 Overview — platform stats, your 15% commission total, approve/reject/takedown/restore, enable Content ID on any release
- 👥 Users & Plans — every artist, their plan, profile count, releases; change plans or suspend (kills their sessions + login instantly)
- 🎬 Content ID dashboard — per-track claim counts and estimated revenue for every Content ID release

🏗️ What's inside
- `server.js` — zero-dependency Node.js backend: auth (scrypt-hashed passwords, signed session
  tokens), releases API, audio/artwork storage, distribution state engine, royalty simulator,
  admin decision endpoints, JSON database in `data/db.json`.
- `public/index.html` — the full app: landing page, auth, 5-step upload wizard with real
  file uploads, per-store live tracking, charts, splits, payouts, settings, admin panel.

🔌 Going to real stores (the honest next step)
This platform's upload/review/live pipeline mirrors how real distribution works. To push
releases into Spotify/Apple for real you need a distribution partner with existing DSP deals:
FUGA, The Orchard, Symphonic, Vydia, or Songtradr. Their APIs replace the
simulated delivery step — your admin approval pipeline stays exactly the same, and royalties
arrive as real DDEX reports instead of estimates.

Demo streams/earnings are simulated deterministically per release so you can demo the full
money flow today.
