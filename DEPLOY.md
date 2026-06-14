# Deploy AfrieConnect to afrieconnect.afriezon.com

**App root (subdomain document root):** `/home/afriezon/afrieconnect.afriezon.com`  
**GitHub:** `https://github.com/ssendisamuel/afrieconnect`

cPanel created `afrieconnect.afriezon.com` as the subdomain’s public folder. Deploy **inside that folder** — do not clone into a different path. PM2, `.env`, `node_modules`, and the app code all live here.

Express serves the UI from `public/` on port **3600**. Apache/Nginx must **proxy** the subdomain to Node (do not rely on Apache serving static files alone, or API routes will 404).

## 1. Server prerequisites

- Node.js 18+ and npm
- MySQL database (cPanel)
- PM2: `npm install -g pm2`
- Reverse proxy from `afrieconnect.afriezon.com` → `http://127.0.0.1:3600`

## 2. Database (cPanel)

| Setting  | Value              |
|----------|--------------------|
| Database | `afriezon_afrieco` |
| User     | `afriezon_afrieco` |
| Host     | `localhost`        |
| Password | *(cPanel only — never commit)* |

Migrations run automatically on startup. On a **fresh empty database**, the app creates base tables from `db/schema.sql` automatically.

If startup still fails with missing tables, import manually:

```bash
cd /home/afriezon/afrieconnect.afriezon.com
grep -v -E '^(CREATE DATABASE|^USE )' db/schema.sql | mysql -u afriezon_afrieco -p afriezon_afrieco
node src/seed.js
pm2 restart afrieconnect --update-env
```

**Unicode / contact import errors** (`Incorrect string value` for `contacts.name`): production tables may have been created without `utf8mb4`. Fix once:

```bash
mysql -u afriezon_afrieco -p afriezon_afrieco <<'SQL'
ALTER DATABASE afriezon_afrieco CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE contacts CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE contact_lists CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE users CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE templates CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE campaigns CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE message_logs CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
SQL
```

Or `git pull` and `pm2 restart afrieconnect --update-env` — migrations convert tables automatically on startup.

## 3. First deploy (inside the subdomain folder)

```bash
cd /home/afriezon/afrieconnect.afriezon.com
```

### If the folder is empty (or only has a default cPanel `index.html`)

Clone **into the current directory** (note the `.` at the end):

```bash
git clone https://github.com/ssendisamuel/afrieconnect.git .
```

### If the folder exists but is not a git repo (your earlier error)

Back up anything you need, clear the folder, then clone in place:

```bash
cd /home/afriezon/afrieconnect.afriezon.com
ls -la
# remove stray files only — keep the folder itself (it is the subdomain docroot)
rm -rf ./* ./.[!.]* 2>/dev/null
git clone https://github.com/ssendisamuel/afrieconnect.git .
```

### If the repo is private

```bash
git clone https://YOUR_GITHUB_USER:YOUR_TOKEN@github.com/ssendisamuel/afrieconnect.git .
```

### Install and configure

```bash
cd /home/afriezon/afrieconnect.afriezon.com
npm install --omit=dev
cp .env.production.example .env
nano .env
```

Confirm `package.json` exists:

```bash
ls package.json server.js ecosystem.config.js
```

Required production values in `.env`:

- `DB_NAME`, `DB_USER`, `DB_PASS`
- `JWT_SECRET` (64+ random characters)
- `FLUTTERWAVE_WEBHOOK_SECRET`
- `APP_URL=https://afrieconnect.afriezon.com`
- `TRUST_PROXY=true`

## 4. Start with PM2

Run from the same subdomain folder:

```bash
cd /home/afriezon/afrieconnect.afriezon.com
pm2 start ecosystem.config.js --env production
pm2 save
pm2 startup
```

Check:

```bash
pm2 status
curl -s http://127.0.0.1:3600/api/health
```

## 5. Reverse proxy (subdomain → Node)

Point `afrieconnect.afriezon.com` at `http://127.0.0.1:3600`.

**Apache (cPanel)** — create or edit `.htaccess` in this folder:

```apache
DirectoryIndex disabled
RewriteEngine On

# cPanel defaults to index.php; proxy app root to Node instead
RewriteRule ^$ http://127.0.0.1:3600/ [P,L]
RewriteRule ^index\.php$ http://127.0.0.1:3600/ [P,L]

RewriteCond %{REQUEST_FILENAME} !-f
RewriteCond %{REQUEST_FILENAME} !-d
RewriteRule ^(.*)$ http://127.0.0.1:3600/$1 [P,L]
```

Set permissions so Apache can read it: `chmod 755 . && chmod 644 .htaccess`

Proxy module must be enabled in cPanel (Apache Configuration → Include Editor, or ask host to enable `mod_proxy`).

**Or** use cPanel **Setup Node.js App** with application root = `/home/afriezon/afrieconnect.afriezon.com` and startup file `server.js`.

**Webhooks**

- Flutterwave: `https://afrieconnect.afriezon.com/api/payments/webhook`
- SMS DLR: `https://afrieconnect.afriezon.com/api/sms/webhook/dlr`
- SMS inbound: `https://afrieconnect.afriezon.com/api/sms/webhook/inbound`

Configure Flutterwave in Admin → Payment Gateways.

## 6. Updates (one command)

On the **server**:

```bash
cd /home/afriezon/afrieconnect.afriezon.com && ./deploy.sh
```

From your **Mac** (after `export DEPLOY_SSH=root@YOUR_SERVER_IP` once):

```bash
./scripts/deploy-remote.sh
```

The deploy script pulls latest code, runs `npm install --omit=dev`, fixes permissions, restarts PM2, and checks `/api/health`.

Manual steps (same as the script):

```bash
cd /home/afriezon/afrieconnect.afriezon.com
git pull origin main
npm install --omit=dev
pm2 restart afrieconnect --update-env
```

## 7. WhatsApp sessions

`wa_sessions/` must persist in this folder across restarts. Do not delete it on deploy.

## 8. Security

- Never commit `.env` to GitHub
- Rotate DB password if it was shared in chat
- Optional: set `SMS_WEBHOOK_SECRET` and append `?secret=...` to SMS webhook URLs
