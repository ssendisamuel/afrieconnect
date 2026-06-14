(function () {
  if (!requireAuth()) return;
  renderAppShell('payments');

  document.getElementById('page-content').innerHTML = `
    <div class="mb-4">
      <h4 class="mb-1 fw-bold">Payments Center</h4>
      <p class="text-muted mb-0">Top up your wallet with MTN MoMo, Airtel Money, or Visa/Mastercard</p>
    </div>

    <div class="row g-4 mb-4">
      <div class="col-md-4">
        <div class="stat-card">
          <div class="stat-icon bg-primary bg-opacity-10 text-primary"><i class="bi bi-wallet2"></i></div>
          <div>
            <div class="stat-value" id="wallet-balance">—</div>
            <div class="stat-label">Wallet Balance (UGX)</div>
          </div>
        </div>
      </div>
      <div class="col-md-4">
        <div class="stat-card">
          <div class="stat-icon bg-success bg-opacity-10 text-success"><i class="bi bi-chat-text"></i></div>
          <div>
            <div class="stat-value" id="sms-rate">—</div>
            <div class="stat-label">Your SMS Rate / part</div>
          </div>
        </div>
      </div>
      <div class="col-md-4">
        <div class="stat-card">
          <div class="stat-icon bg-info bg-opacity-10 text-info"><i class="bi bi-calculator"></i></div>
          <div>
            <div class="stat-value" id="sms-estimate">—</div>
            <div class="stat-label">SMS you can send (est.)</div>
          </div>
        </div>
      </div>
    </div>

    <div class="row g-4 mb-4">
      <div class="col-lg-6">
        <div class="content-card">
          <h6 class="fw-semibold mb-3"><i class="bi bi-credit-card me-2"></i>Top Up Wallet</h6>

          <ul class="nav nav-pills mb-3" id="pay-method-tabs">
            <li class="nav-item"><button type="button" class="nav-link active" data-method="mobile_money">Mobile Money</button></li>
            <li class="nav-item"><button type="button" class="nav-link" data-method="card">Visa / Mastercard</button></li>
          </ul>

          <form id="topup-form">
            <div class="mb-3">
              <label class="form-label">Amount (UGX)</label>
              <div class="d-flex flex-wrap gap-2 mb-2" id="package-buttons"></div>
              <input type="number" class="form-control" id="amount" min="1000" step="500" placeholder="Or enter custom amount" required>
            </div>

            <div id="mobile-money-fields">
              <div class="mb-3">
                <label class="form-label">Network</label>
                <select class="form-select" id="network" required>
                  <option value="MTN">MTN Mobile Money</option>
                  <option value="AIRTEL">Airtel Money</option>
                </select>
              </div>
              <div class="mb-3">
                <label class="form-label">MoMo Phone Number</label>
                <input type="tel" class="form-control" id="phone" placeholder="2567XXXXXXXX or 07XXXXXXXX">
              </div>
            </div>

            <div id="card-fields" class="d-none">
              <div class="row g-3 mb-3">
                <div class="col-12">
                  <label class="form-label">Card Number</label>
                  <input type="text" class="form-control" id="card-number" inputmode="numeric" autocomplete="cc-number" placeholder="4111 1111 1111 1111">
                </div>
                <div class="col-md-4">
                  <label class="form-label">Expiry Month</label>
                  <input type="text" class="form-control" id="card-exp-month" inputmode="numeric" maxlength="2" placeholder="09">
                </div>
                <div class="col-md-4">
                  <label class="form-label">Expiry Year</label>
                  <input type="text" class="form-control" id="card-exp-year" inputmode="numeric" maxlength="2" placeholder="28">
                </div>
                <div class="col-md-4">
                  <label class="form-label">CVV</label>
                  <input type="password" class="form-control" id="card-cvv" inputmode="numeric" maxlength="4" placeholder="123">
                </div>
              </div>
              <p class="small text-muted mb-0">Card details are encrypted in your browser before being sent to Flutterwave.</p>
            </div>

            <button type="submit" class="btn btn-primary btn-lg w-100 mt-3" id="btn-topup">
              <i class="bi bi-lightning-charge me-2"></i>Pay Now
            </button>
          </form>
          <div id="payment-status" class="alert alert-info small mt-3 d-none"></div>
        </div>
      </div>

      <div class="col-lg-6">
        <div class="content-card mb-4">
          <h6 class="fw-semibold mb-3">How billing works</h6>
          <ul class="small text-muted mb-0">
            <li class="mb-2">Your wallet holds <strong>UGX</strong>, not abstract credits.</li>
            <li class="mb-2">Pay with <strong>MTN MoMo</strong>, <strong>Airtel Money</strong>, or <strong>Visa/Mastercard</strong>.</li>
            <li class="mb-2">Each SMS deducts the real cost (e.g. UGX 40 × number of 160-char parts).</li>
            <li>Long messages use multiple parts (320 chars = 2 parts = 2× cost).</li>
          </ul>
        </div>

        <div class="content-card table-card">
          <h6 class="fw-semibold mb-3">Wallet History</h6>
          <div class="table-responsive">
            <table class="table table-sm align-middle">
              <thead><tr><th>Date</th><th>Type</th><th>Amount</th><th>Balance</th></tr></thead>
              <tbody id="tx-body"><tr><td colspan="4" class="text-center text-muted py-3">Loading…</td></tr></tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  `;

  let smsRate = 40;
  let paymentMethod = 'mobile_money';
  let encryptionKey = null;
  let cardPaymentsEnabled = false;

  function generateNonce(length = 12) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    const bytes = crypto.getRandomValues(new Uint8Array(length));
    let nonce = '';
    for (let i = 0; i < length; i++) nonce += chars[bytes[i] % chars.length];
    return nonce;
  }

  async function encryptFlutterwaveField(value, key, nonce) {
    const keyBytes = Uint8Array.from(atob(key), c => c.charCodeAt(0));
    const cryptoKey = await crypto.subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, false, ['encrypt']);
    const iv = new TextEncoder().encode(nonce);
    const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, cryptoKey, new TextEncoder().encode(String(value)));
    return btoa(String.fromCharCode(...new Uint8Array(encrypted)));
  }

  function getPayButtonDefaultHtml() {
    return paymentMethod === 'card'
      ? '<i class="bi bi-credit-card me-2"></i>Pay with Card'
      : '<i class="bi bi-lightning-charge me-2"></i>Pay with Mobile Money';
  }

  function setPayButtonProcessing(isProcessing) {
    const btn = document.getElementById('btn-topup');
    const form = document.getElementById('topup-form');
    if (!btn || !form) return;

    btn.disabled = isProcessing;
    form.querySelectorAll('input, select').forEach(el => { el.disabled = isProcessing; });
    document.querySelectorAll('#pay-method-tabs .nav-link').forEach(tab => {
      tab.disabled = isProcessing;
      tab.classList.toggle('disabled', isProcessing);
    });

    btn.innerHTML = isProcessing
      ? '<span class="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>Processing payment…'
      : getPayButtonDefaultHtml();
  }

  function setPaymentMethod(method) {
    if (pollTimer) return;
    paymentMethod = method;
    document.querySelectorAll('#pay-method-tabs .nav-link').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.method === method);
    });
    document.getElementById('mobile-money-fields').classList.toggle('d-none', method !== 'mobile_money');
    document.getElementById('card-fields').classList.toggle('d-none', method !== 'card');
    document.getElementById('phone').required = method === 'mobile_money';
    document.getElementById('btn-topup').innerHTML = getPayButtonDefaultHtml();
  }

  document.querySelectorAll('#pay-method-tabs .nav-link').forEach(btn => {
    btn.addEventListener('click', () => setPaymentMethod(btn.dataset.method));
  });

  async function loadWallet() {
    const data = await api('/api/wallet/balance');
    smsRate = data.sms_rate || 40;
    document.getElementById('wallet-balance').textContent = Number(data.wallet_balance).toLocaleString();
    document.getElementById('sms-rate').textContent = `UGX ${smsRate}`;
    const estimate = Math.floor((data.wallet_balance || 0) / smsRate);
    document.getElementById('sms-estimate').textContent = estimate.toLocaleString();

    const user = getUser();
    if (user && data.wallet_balance !== undefined) {
      user.wallet_balance = data.wallet_balance;
      user.sms_credits = data.wallet_balance;
      localStorage.setItem('afrieconnect_user', JSON.stringify(user));
    }
  }

  async function loadTransactions() {
    const data = await api('/api/wallet/transactions?limit=20');
    const tbody = document.getElementById('tx-body');
    if (!data.transactions?.length) {
      tbody.innerHTML = '<tr><td colspan="4" class="text-center text-muted py-3">No transactions yet</td></tr>';
      return;
    }
    tbody.innerHTML = data.transactions.map(t => `
      <tr>
        <td class="small">${formatDate(t.created_at)}</td>
        <td class="small">${t.description || t.type}</td>
        <td class="${t.amount >= 0 ? 'text-success' : 'text-danger'} fw-semibold">${t.amount >= 0 ? '+' : ''}${Number(t.amount).toLocaleString()}</td>
        <td class="small">${Number(t.balance_after).toLocaleString()}</td>
      </tr>
    `).join('');
  }

  async function loadPackages() {
    const data = await api('/api/payments/packages');
    const wrap = document.getElementById('package-buttons');
    wrap.innerHTML = data.packages.map(p => `
      <button type="button" class="btn btn-outline-primary btn-sm pkg-btn" data-amount="${p.amount}">${p.label}</button>
    `).join('');

    wrap.querySelectorAll('.pkg-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.getElementById('amount').value = btn.dataset.amount;
      });
    });

    encryptionKey = data.encryption_key;
    cardPaymentsEnabled = Boolean(data.card_payments_enabled);

    if (!data.flutterwave_configured) {
      document.getElementById('payment-status').classList.remove('d-none');
      document.getElementById('payment-status').className = 'alert alert-warning small mt-3';
      document.getElementById('payment-status').textContent =
        'Flutterwave is not configured yet. Ask admin to add FLUTTERWAVE_CLIENT_ID and FLUTTERWAVE_CLIENT_SECRET to .env. Manual top-up by admin still works.';
    } else if (!cardPaymentsEnabled) {
      document.querySelector('#pay-method-tabs [data-method="card"]').classList.add('disabled');
    }
  }

  let pollTimer = null;

  function showPaymentWaiting(statusEl, message, txRef) {
    statusEl.classList.remove('d-none');
    statusEl.className = 'alert alert-info small mt-3';
    statusEl.innerHTML = `
      <div class="d-flex align-items-start gap-2">
        <div class="spinner-border spinner-border-sm text-primary mt-1" role="status" aria-hidden="true"></div>
        <div>
          <strong>Waiting for payment confirmation…</strong>
          <div class="mt-1">${message || 'Approve the prompt on your phone. This page updates automatically.'}</div>
          <div class="text-muted mt-1">Checking every 3 seconds${txRef ? ` · Ref ${txRef.slice(-8)}` : ''}</div>
        </div>
      </div>`;
  }

  function showPaymentSuccess(statusEl, amount, walletBalance) {
    statusEl.className = 'alert alert-success small mt-3';
    statusEl.innerHTML = `
      <strong>Payment successful!</strong>
      Wallet topped up with UGX ${Number(amount).toLocaleString()}.
      ${walletBalance !== undefined ? ` New balance: UGX ${Number(walletBalance).toLocaleString()}.` : ''}`;
  }

  function showPaymentFailed(statusEl, message) {
    statusEl.className = 'alert alert-danger small mt-3';
    statusEl.textContent = message || 'Payment failed. Please try again.';
  }

  async function waitForPayment(txRef, amount, statusEl) {
    if (pollTimer) clearInterval(pollTimer);

    const finish = (outcome) => {
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
      setPayButtonProcessing(false);
      return outcome;
    };

    const check = async () => {
      try {
        const verified = await api(`/api/payments/verify/${encodeURIComponent(txRef)}`);
        if (verified.status === 'successful') {
          showPaymentSuccess(statusEl, verified.amount || amount, verified.wallet_balance);
          await loadWallet();
          await loadTransactions();
          showToast('Wallet updated');
          if (window.history.replaceState) {
            window.history.replaceState({}, '', '/app/payments.html');
          }
          return finish(true);
        }
        if (verified.status === 'failed') {
          showPaymentFailed(statusEl, verified.message);
          return finish(false);
        }
        showPaymentWaiting(statusEl, verified.message, txRef);
        return null;
      } catch (err) {
        showPaymentWaiting(statusEl, err.message || 'Still checking with Flutterwave…', txRef);
        return null;
      }
    };

    const first = await check();
    if (first !== null) return first;

    pollTimer = setInterval(async () => {
      await check();
    }, 2000);

    setTimeout(() => {
      if (pollTimer) {
        pollTimer = null;
        statusEl.className = 'alert alert-warning small mt-3';
        statusEl.innerHTML = `<strong>Still pending.</strong> If you already paid, refresh this page — we will sync automatically.`;
        setPayButtonProcessing(false);
      }
    }, 300000);
  }

  async function buildCardPayload() {
    if (!encryptionKey) throw new Error('Card payments are not configured');
    const nonce = generateNonce();
    const cardNumber = document.getElementById('card-number').value.replace(/\s/g, '');
    const expMonth = document.getElementById('card-exp-month').value.padStart(2, '0');
    const expYear = document.getElementById('card-exp-year').value.slice(-2);
    const cvv = document.getElementById('card-cvv').value;

    if (!cardNumber || !expMonth || !expYear || !cvv) {
      throw new Error('Enter complete card details');
    }

    return {
      nonce,
      encrypted_card_number: await encryptFlutterwaveField(cardNumber, encryptionKey, nonce),
      encrypted_expiry_month: await encryptFlutterwaveField(expMonth, encryptionKey, nonce),
      encrypted_expiry_year: await encryptFlutterwaveField(expYear, encryptionKey, nonce),
      encrypted_cvv: await encryptFlutterwaveField(cvv, encryptionKey, nonce)
    };
  }

  document.getElementById('topup-form').addEventListener('submit', async e => {
    e.preventDefault();
    const statusEl = document.getElementById('payment-status');
    setPayButtonProcessing(true);

    try {
      const payload = {
        amount: parseFloat(document.getElementById('amount').value),
        method: paymentMethod
      };

      if (paymentMethod === 'mobile_money') {
        payload.network = document.getElementById('network').value;
        payload.phone = document.getElementById('phone').value.trim();
      } else {
        payload.card = await buildCardPayload();
      }

      const result = await api('/api/payments/initiate', {
        method: 'POST',
        body: JSON.stringify(payload)
      });

      statusEl.classList.remove('d-none');
      showPaymentWaiting(statusEl, result.message, result.tx_ref);

      if (result.redirect_url && paymentMethod === 'card') {
        window.open(result.redirect_url, '_blank', 'noopener');
      }

      if (result.tx_ref) {
        await waitForPayment(result.tx_ref, payload.amount, statusEl);
      } else {
        setPayButtonProcessing(false);
      }
    } catch (err) {
      statusEl.classList.remove('d-none');
      statusEl.className = 'alert alert-danger small mt-3';
      statusEl.textContent = err.message;
      setPayButtonProcessing(false);
    }
  });

  const txRef = new URLSearchParams(window.location.search).get('tx_ref');
  if (txRef) {
    const statusEl = document.getElementById('payment-status');
    statusEl.classList.remove('d-none');
    setPayButtonProcessing(true);
    waitForPayment(txRef, null, statusEl).catch(err => {
      showToast(err.message, 'error');
      setPayButtonProcessing(false);
    });
  }

  loadWallet().catch(err => showToast(err.message, 'error'));
  loadTransactions().catch(err => showToast(err.message, 'error'));
  loadPackages().catch(() => {});
})();
