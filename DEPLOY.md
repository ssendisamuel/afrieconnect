# Deploy AfrieConnect to afrieconnect.afriezon.com

Target server path: `/home/afriezon/afrieconnect.afriezon.com`  
GitHub repo: `https://github.com/ssendisamuel/afrieconnect`

## 1. Server prerequisites

- Node.js 18+ and npm
- MySQL database (already created in cPanel)
- PM2: `npm install -g pm2`
- Reverse proxy (Apache/Nginx) to port `3600`

## 2. Database (cPanel)

From your hosting panel you created:

| Setting | Value |
|---------|--------|
| Database | `afriezon_afrieco` |
| User | `afriezon_afrieco` |
| Host | `localhost` |
| Password | *(set in panel — do not commit to git)* |

The app runs migrations automatically on startup. You do **not** need to import `db/schema.sql` manually if the app starts successfully.

## 3. First deploy

```bash
cd /home/afriezon
git clone https://github.com/ssendisamuel/afrieconnect.git afrieconnect.afriezon.com
cd afrieconnect.afriezon.com
npm install --production
cp .env.production.example .env
nano .env   # fill DB password, JWT_SECRET, Flutterwave, EgoSMS, SMTP
```

Required production values in `.env`:

- `DB_NAME`, `DB_USER`, `DB_PASS`
- `JWT_SECRET` (64+ random characters)
- `FLUTTERWAVE_WEBHOOK_SECRET`
- `APP_URL=https://afrieconnect.afriezon.com`
- `TRUST_PROXY=true`

## 4. Start with PM2

```bash
pm2 start ecosystem.config.js --env production
pm2 save
pm2 startup
```

## 5. Reverse proxy

Point `afrieconnect.afriezon.com` to `http://127.0.0.1:3600`.

**Flutterwave webhook:** `https://afrieconnect.afriezon.com/api/payments/webhook`  
Configure in Admin → Payment Gateways.

**SMS webhooks (EgoSMS):**

- DLR: `https://afrieconnect.afriezon.com/api/sms/webhook/dlr`
- Inbound: `https://afrieconnect.afriezon.com/api/sms/webhook/inbound`

## 6. Updates

```bash
cd /home/afriezon/afrieconnect.afriezon.com
git pull origin main
npm install --production
pm2 restart afrieconnect
```

## 7. WhatsApp sessions

The `wa_sessions/` folder must persist across restarts. Do not delete it on deploy.

## 8. Security notes

- Never commit `.env` to GitHub
- Rotate the DB password if it was shared in chat
- Set `SMS_WEBHOOK_SECRET` and append `?secret=...` to SMS webhook URLs if desired
