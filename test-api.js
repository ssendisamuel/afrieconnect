require('dotenv').config();

async function test() {
  const tests = [];

  const health = await fetch('http://localhost:3600/api/health').then(r => r.json());
  tests.push({ name: 'Health check', ok: health.success === true });

  const login = await fetch('http://localhost:3600/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: process.env.ADMIN_EMAIL,
      password: process.env.ADMIN_PASSWORD
    })
  }).then(r => r.json());

  tests.push({ name: 'Admin login', ok: login.success === true && !!login.token });

  if (login.token) {
    const headers = { Authorization: `Bearer ${login.token}` };

    const me = await fetch('http://localhost:3600/api/auth/me', { headers }).then(r => r.json());
    tests.push({ name: 'Auth /me', ok: me.success && me.user.role === 'admin' });

    const dash = await fetch('http://localhost:3600/api/dashboard/stats', { headers }).then(r => r.json());
    tests.push({ name: 'Dashboard stats', ok: dash.success === true });

    const wa = await fetch('http://localhost:3600/api/wa/status', { headers }).then(r => r.json());
    tests.push({ name: 'WhatsApp status', ok: wa.success === true });

    const sms = await fetch('http://localhost:3600/api/sms/balance', { headers }).then(r => r.json());
    tests.push({ name: 'SMS balance', ok: sms.success === true });

    const contacts = await fetch('http://localhost:3600/api/contacts/lists', { headers }).then(r => r.json());
    tests.push({ name: 'Contact lists', ok: contacts.success === true });

    const campaigns = await fetch('http://localhost:3600/api/campaigns', { headers }).then(r => r.json());
    tests.push({ name: 'Campaigns list', ok: campaigns.success === true });

    const templates = await fetch('http://localhost:3600/api/templates', { headers }).then(r => r.json());
    tests.push({ name: 'Templates list', ok: templates.success === true && templates.templates.length >= 2 });

    const adminUsers = await fetch('http://localhost:3600/api/admin/users', { headers }).then(r => r.json());
    tests.push({ name: 'Admin users', ok: adminUsers.success === true });

    const adminStats = await fetch('http://localhost:3600/api/admin/stats', { headers }).then(r => r.json());
    tests.push({ name: 'Admin stats', ok: adminStats.success === true });
  }

  const pages = ['/', '/login.html', '/register.html', '/app/index.html', '/pricing.html', '/whatsapp.html'];
  for (const page of pages) {
    const res = await fetch(`http://localhost:3600${page}`);
    tests.push({ name: `Page ${page}`, ok: res.status === 200 });
  }

  console.log('\n=== AfrieConnect Test Results ===\n');
  let passed = 0;
  for (const t of tests) {
    console.log(`${t.ok ? '✓' : '✗'} ${t.name}`);
    if (t.ok) passed++;
  }
  console.log(`\n${passed}/${tests.length} passed\n`);
  process.exit(passed === tests.length ? 0 : 1);
}

test().catch(err => {
  console.error('Test failed:', err.message);
  process.exit(1);
});
