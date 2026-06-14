const AUTH_TOKEN_KEY = 'afrieconnect_token';
const AUTH_USER_KEY = 'afrieconnect_user';

function setAuth(token, user) {
  localStorage.setItem(AUTH_TOKEN_KEY, token);
  localStorage.setItem(AUTH_USER_KEY, JSON.stringify(user));
}

function showAuthAlert(container, message, type = 'danger') {
  if (!container) return;
  container.innerHTML = `<div class="alert alert-${type} mb-3" role="alert">${message}</div>`;
}

function clearAuthAlert(container) {
  if (container) container.innerHTML = '';
}

function setButtonLoading(btn, loading, defaultText) {
  if (!btn) return;
  btn.disabled = loading;
  btn.innerHTML = loading
    ? '<span class="spinner-border spinner-border-sm me-2"></span>Please wait...'
    : defaultText;
}

async function parseAuthResponse(res) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data.message || data.errors?.[0]?.msg || `Request failed (${res.status})`;
    const err = new Error(msg);
    err.code = data.code;
    err.status = res.status;
    throw err;
  }
  return data;
}

function isUnverifiedError(err) {
  return err.code === 'EMAIL_NOT_VERIFIED'
    || (err.status === 403 && /verify your email/i.test(err.message || ''));
}

function showUnverifiedAlert(container, form) {
  if (!container) return;
  container.innerHTML = `
    <div class="alert alert-warning mb-3" role="alert">
      <div class="mb-2">Please verify your email before logging in.</div>
      <button type="button" class="btn btn-outline-primary btn-sm" id="resend-verify-btn">
        <i class="bi bi-envelope me-1"></i>Resend verification email
      </button>
    </div>`;

  document.getElementById('resend-verify-btn').addEventListener('click', () => {
    handleResendVerification(form);
  });
}

async function handleResendVerification(form) {
  const alertEl = document.getElementById('auth-alert');
  const btn = document.getElementById('resend-verify-btn')
    || document.getElementById('resend-verify-link');
  if (!form?.email?.value || !form?.password?.value) {
    showAuthAlert(alertEl, 'Enter your email and password above, then click resend.', 'warning');
    return;
  }

  const originalHtml = btn?.innerHTML;
  if (btn) {
    btn.disabled = true;
    if (btn.tagName === 'BUTTON') {
      btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>Sending...';
    } else {
      btn.textContent = 'Sending...';
    }
  }

  try {
    const res = await fetch('/api/auth/resend-verification', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: form.email.value.trim(),
        password: form.password.value
      })
    });
    const data = await parseAuthResponse(res);
    showAuthAlert(alertEl, data.message, 'success');
  } catch (err) {
    showAuthAlert(alertEl, err.message, err.status === 401 ? 'danger' : 'warning');
  } finally {
    if (btn) {
      btn.disabled = false;
      if (btn.tagName === 'BUTTON') {
        btn.innerHTML = originalHtml || '<i class="bi bi-envelope me-1"></i>Resend verification email';
      } else {
        btn.textContent = 'Resend verification email';
      }
    }
  }
}

async function handleLogin(e) {
  e.preventDefault();
  const form = e.target;
  const alertEl = document.getElementById('auth-alert');
  const btn = form.querySelector('[type="submit"]');
  clearAuthAlert(alertEl);
  setButtonLoading(btn, true, btn.dataset.defaultText || 'Sign In');

  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: form.email.value.trim(),
        password: form.password.value
      })
    });
    const data = await parseAuthResponse(res);
    setAuth(data.token, data.user);
    window.location.href = '/app/index.html';
  } catch (err) {
    if (isUnverifiedError(err)) {
      showUnverifiedAlert(alertEl, form);
    } else {
      showAuthAlert(alertEl, err.message);
    }
    setButtonLoading(btn, false, btn.dataset.defaultText || 'Sign In');
  }
}

async function handleRegister(e) {
  e.preventDefault();
  const form = e.target;
  const alertEl = document.getElementById('auth-alert');
  const btn = form.querySelector('[type="submit"]');
  clearAuthAlert(alertEl);

  if (form.password.value !== form.confirmPassword.value) {
    showAuthAlert(alertEl, 'Passwords do not match');
    return;
  }

  if (!form.terms?.checked) {
    showAuthAlert(alertEl, 'Please accept the terms and conditions');
    return;
  }

  setButtonLoading(btn, true, btn.dataset.defaultText || 'Create Account');

  try {
    const res = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: form.name.value.trim(),
        email: form.email.value.trim(),
        phone: form.phone.value.trim(),
        password: form.password.value
      })
    });
    const data = await parseAuthResponse(res);
    showAuthAlert(alertEl, data.message, 'success');
    form.reset();
    setTimeout(() => { window.location.href = '/login.html'; }, 3000);
  } catch (err) {
    showAuthAlert(alertEl, err.message);
    setButtonLoading(btn, false, btn.dataset.defaultText || 'Create Account');
  }
}

async function handleForgotPassword(e) {
  e.preventDefault();
  const form = e.target;
  const alertEl = document.getElementById('auth-alert');
  const btn = form.querySelector('[type="submit"]');
  clearAuthAlert(alertEl);
  setButtonLoading(btn, true, btn.dataset.defaultText || 'Send Reset Link');

  try {
    const res = await fetch('/api/auth/forgot-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: form.email.value.trim() })
    });
    const data = await parseAuthResponse(res);
    showAuthAlert(alertEl, data.message, 'success');
    form.reset();
  } catch (err) {
    showAuthAlert(alertEl, err.message);
  } finally {
    setButtonLoading(btn, false, btn.dataset.defaultText || 'Send Reset Link');
  }
}

async function handleResetPassword(e) {
  e.preventDefault();
  const form = e.target;
  const alertEl = document.getElementById('auth-alert');
  const btn = form.querySelector('[type="submit"]');
  clearAuthAlert(alertEl);

  if (form.password.value !== form.confirmPassword.value) {
    showAuthAlert(alertEl, 'Passwords do not match');
    return;
  }

  const token = form.token.value || new URLSearchParams(window.location.search).get('token');
  if (!token) {
    showAuthAlert(alertEl, 'Invalid or missing reset token');
    return;
  }

  setButtonLoading(btn, true, btn.dataset.defaultText || 'Reset Password');

  try {
    const res = await fetch('/api/auth/reset-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token,
        password: form.password.value
      })
    });
    const data = await parseAuthResponse(res);
    showAuthAlert(alertEl, data.message, 'success');
    setTimeout(() => { window.location.href = '/login.html'; }, 2000);
  } catch (err) {
    showAuthAlert(alertEl, err.message);
    setButtonLoading(btn, false, btn.dataset.defaultText || 'Reset Password');
  }
}

async function verifyEmailToken() {
  const alertEl = document.getElementById('verify-status');
  const token = new URLSearchParams(window.location.search).get('token');

  if (!token) {
    showAuthAlert(alertEl, 'No verification token found in the link.', 'danger');
    return;
  }

  try {
    const res = await fetch(`/api/auth/verify-email/${encodeURIComponent(token)}`);
    const data = await parseAuthResponse(res);
    showAuthAlert(alertEl, data.message, 'success');
    setTimeout(() => { window.location.href = '/login.html'; }, 3000);
  } catch (err) {
    showAuthAlert(alertEl, err.message, 'danger');
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const loginForm = document.getElementById('login-form');
  if (loginForm) {
    loginForm.addEventListener('submit', handleLogin);
    const resendLink = document.getElementById('resend-verify-link');
    if (resendLink) {
      resendLink.addEventListener('click', e => {
        e.preventDefault();
        handleResendVerification(loginForm);
      });
    }
  }

  const registerForm = document.getElementById('register-form');
  if (registerForm) registerForm.addEventListener('submit', handleRegister);

  const forgotForm = document.getElementById('forgot-form');
  if (forgotForm) forgotForm.addEventListener('submit', handleForgotPassword);

  const resetForm = document.getElementById('reset-form');
  if (resetForm) {
    const token = new URLSearchParams(window.location.search).get('token');
    const tokenInput = resetForm.querySelector('[name="token"]');
    if (tokenInput && token) tokenInput.value = token;
    resetForm.addEventListener('submit', handleResetPassword);
  }

  if (document.getElementById('verify-status')) {
    verifyEmailToken();
  }
});

window.handleLogin = handleLogin;
window.setAuth = setAuth;
