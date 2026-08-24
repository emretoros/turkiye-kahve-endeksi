(() => {
const accessHash = '93b12dd444a6edd34215e3d29aec467be3c3bbadcca52bd333447c7603421c15';
const storageKey = 'cekirdek-bul-access-v1';
const base = document.body.dataset.base || '/';
const gate = document.getElementById('access-gate');
const form = document.getElementById('access-form');
const input = document.getElementById('access-password');
const error = document.getElementById('access-error');
const submit = form.querySelector('button[type="submit"]');

function loadApplication() {
  if (document.getElementById('coffee-index-app')) return;
  const script = document.createElement('script');
  script.id = 'coffee-index-app';
  script.src = `${base}app.js?v=20260824-2`;
  script.async = false;
  document.body.appendChild(script);
}

function unlock() {
  document.body.classList.remove('is-locked');
  gate.hidden = true;
  gate.setAttribute('aria-hidden', 'true');
  loadApplication();
  document.getElementById('site-title')?.focus({ preventScroll: true });
}

function readStoredAccess() {
  try { return sessionStorage.getItem(storageKey); } catch { return null; }
}

function storeAccess() {
  try { sessionStorage.setItem(storageKey, accessHash); } catch {}
}

async function digest(value) {
  const bytes = new TextEncoder().encode(value);
  const result = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(result)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

if (readStoredAccess() === accessHash) {
  unlock();
} else {
  requestAnimationFrame(() => input.focus());
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    error.textContent = '';
    input.removeAttribute('aria-invalid');
    submit.disabled = true;
    try {
      if (await digest(input.value.trim()) === accessHash) {
        storeAccess();
        unlock();
        return;
      }
      error.textContent = 'Şifre doğru değil.';
      input.setAttribute('aria-invalid', 'true');
      input.select();
    } catch {
      error.textContent = 'Giriş kontrolü bu tarayıcıda çalıştırılamadı.';
    } finally {
      submit.disabled = false;
    }
  });
}
})();
