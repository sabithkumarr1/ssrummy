# Sathya's Rummy — online multiplayer (virtual coins)

Node.js app: accounts, an admin wallet page, and **shared 101-Pool rummy tables** where several logged-in players join one table and play together (empty seats are filled by bots). No external libraries — the database is a plain `db.json` file.

## Requirements
- Node.js v16+  (check: `node -v`)

## Run
```bash
cd ssrummy
node server.js
```
Open **http://localhost:3000** in a browser.

Everything must go through the running server. Opening the HTML files directly (file://) will NOT work — every request needs the server.

To let friends join from their own phones, host it online (Render, Railway, a VPS…) and share that URL. Their join links will use that same address.

## Player flow
1. **Create account** — Name, Phone, Password, and the **Secret key `ssrummy`** (change in `server.js` → `SIGNUP_SECRET`).
2. **Lobby** — create a table (name, seats 2–6, entry Free/₹25/₹50/₹100/Custom). You get a **shareable join link**.
3. **Share the link.** When someone opens it, they log in (if needed), then see the **match fee and confirm** before joining. The fee is deducted from their wallet on join.
4. **Host starts** the table. Any empty seats are filled with bots. Everyone plays the same deals until one player is left standing.

## Wallet rules (virtual coins)
- Joining a paid table deducts the entry into the table **pot**.
- **The pot only contains real players' entries — bots pay nothing.** So you can never win coins by beating bots; against bots you can at best get your own stake back. Coins only move between real humans.
- The last player standing (champion) receives the whole pot. If a bot wins, the pot is not paid out.

## Admin
- Open **http://localhost:3000/admin.html**
- Login: **sathya / Dev@ss** (change in `server.js` → `ADMIN`).
- See every user's wallet and **add coins** to anyone.

## Files
- `server.js` — API, static server, and the authoritative game loop.
- `engine.js` — the rummy rules engine (also served to the browser for declare help).
- `db.json` — users, wallets, games. Back this up to keep balances.
- `public/index.html` — login / signup.
- `public/lobby.html` — wallet, create table (+ join link), open tables list.
- `public/join.html` — the join-link page (shows fee, confirm).
- `public/table.html` — the live table (poll-based multiplayer client).
- `public/admin.html` — admin wallet management.

## Notes
- Virtual coins, not real money. Passwords are stored plainly in `db.json` (fine for a friends setup; add hashing if you need more).
- Tables live in server memory; restarting the server clears in-progress tables (wallets in `db.json` are kept).
- Tuning: `TURN_MS` (turn time limit) and `DEAL_MS` (pause between deals) can be set as env vars, e.g. `DEAL_MS=4000 node server.js`.
