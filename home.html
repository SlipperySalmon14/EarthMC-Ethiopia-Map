'use strict';

/**
 * Ethiopia Ecosystem — Shared auth + tier gating
 *
 * Include this in every page:
 *   <script src="assets/shared.js?v=1"></script>
 *
 * Then use:
 *   window.auth.tier           -> 'unverified' | 'citizen' | 'treasurer' | 'manager'
 *   window.auth.signedIn       -> boolean
 *   window.auth.discordName    -> string or null
 *   window.auth.avatarUrl      -> string or null
 *
 *   window.auth.gate(required)  -> bool, true if current tier >= required
 *   window.auth.hide(element, required) -> hides element if tier doesn't meet it
 *   window.auth.login()         -> redirects to /api/auth/login
 *   window.auth.logout()        -> clears session + reloads
 */

const TIER_ORDER = ['unverified', 'citizen', 'treasurer', 'manager'];

window.auth = {
  tier: 'unverified',
  signedIn: false,
  discordName: null,
  avatarUrl: null,
  mcName: null,
  mcUuid: null,

  /* True if the current tier is >= the required tier */
  gate(required) {
    return TIER_ORDER.indexOf(this.tier) >= TIER_ORDER.indexOf(required);
  },

  /* Hide an element if the tier is insufficient */
  hide(element, required) {
    if (!this.gate(required)) {
      element.style.display = 'none';
    }
  },

  /* Redirect to Discord login */
  login(afterPath) {
    const u = new URL('/api/auth/login', window.location.origin.replace('github.io', 'ethiopianempire2.workers.dev'));
    if (afterPath) u.searchParams.set('redirect', afterPath);
    window.location.href = u.toString();
  },

  /* Log out and reload */
  async logout() {
    try {
      await fetch(
        new URL('/api/auth/logout', window.location.origin.replace('github.io', 'ethiopianempire2.workers.dev')),
        { method: 'POST', credentials: 'include' }
      );
    } catch (_err) { /* logout failure shouldn't crash the page */ }
    window.location.reload();
  },
};

/* --- initialization ---------------------------------------------------- */

/**
 * Load the session and populate window.auth, then emit 'auth:ready'.
 * Pages that need tier data should wait for this event:
 *
 *   window.addEventListener('auth:ready', () => {
 *     if (!window.auth.gate('citizen')) {
 *       window.location.href = '/index.html';
 *     }
 *   });
 */
async function loadAuth() {
  try {
    const u = new URL('/api/me', window.location.origin.replace('github.io', 'ethiopianempire2.workers.dev'));
    const res = await fetch(u.toString(), { credentials: 'include' });
    if (!res.ok) throw new Error(`${res.status}`);

    const data = await res.json();
    Object.assign(window.auth, {
      tier: data.tier || 'unverified',
      signedIn: data.signedIn || false,
      discordName: data.discordName || null,
      avatarUrl: data.avatarUrl || null,
      mcName: data.mcName || null,
      mcUuid: data.mcUuid || null,
    });
  } catch (err) {
    // Network error or /api/me unreachable. Treat as unverified but don't crash.
    console.warn('auth load failed:', err);
  }

  window.dispatchEvent(new CustomEvent('auth:ready'));
}

// Load on page start, before anything else runs.
loadAuth();

/* --- convenience for common patterns ---------------------------------- */

/**
 * Usage:
 *   requireTier('citizen')
 *
 * If not met, shows a dismissible alert and redirects to /index.html
 * in 3 seconds. You can call window.auth.login() from the alert to
 * sign in instead.
 */
window.requireTier = function (required) {
  window.addEventListener('auth:ready', () => {
    if (!window.auth.gate(required)) {
      const msg = `You need to be a ${required} to view this page.`;
      alert(msg);
      setTimeout(() => {
        window.location.href = '/index.html';
      }, 3000);
    }
  });
};

/**
 * Usage:
 *   <div class="citizen-only">This is for citizens only</div>
 *
 *   window.addEventListener('auth:ready', () => {
 *     gateElementsByClass('citizen-only', 'citizen');
 *   });
 */
window.gateElementsByClass = function (className, required) {
  for (const el of document.querySelectorAll('.' + className)) {
    window.auth.hide(el, required);
  }
};

/**
 * Usage:
 *   <button onclick="window.doLogin('/treasury.html')">Sign in</button>
 *
 * Redirects to Discord login, then back to the specified page.
 */
window.doLogin = function (afterPath) {
  window.auth.login(afterPath);
};

/**
 * Usage:
 *   <button onclick="window.doLogout()">Sign out</button>
 */
window.doLogout = function () {
  window.auth.logout();
};

