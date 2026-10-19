// Shared, dependency-free runtime for published Studio countdown widgets and landing interactions.
export const countdownRuntime = `(() => {
  const update = () => {
    document.querySelectorAll('[data-builder-countdown-end]').forEach((element) => {
      const deadline = element.getAttribute('data-builder-countdown-end');
      let target = deadline ? Date.parse(deadline) : Number(element.getAttribute('data-builder-countdown-started'));
      if (!Number.isFinite(target) || target <= 0) {
        const hours = Math.min(8760, Math.max(1, Number(element.getAttribute('data-builder-countdown-hours')) || 24));
        target = Date.now() + hours * 3600000;
        element.setAttribute('data-builder-countdown-started', String(target));
      }
      const remaining = Math.max(0, Math.floor((target - Date.now()) / 1000));
      const values = {
        days: Math.floor(remaining / 86400),
        hours: Math.floor(remaining / 3600) % 24,
        minutes: Math.floor(remaining / 60) % 60,
        seconds: remaining % 60
      };
      for (const [unit, value] of Object.entries(values)) {
        const output = element.querySelector('[data-countdown-unit="' + unit + '"]');
        if (output) output.textContent = String(value).padStart(2, '0');
      }
    });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', update, { once: true });
  else update();
  window.setInterval(update, 1000);

  // Save product-bearing Studio order forms while customers fill them in.
  const setupDrafts = () => {
    let deviceId = '';
    try {
      deviceId = localStorage.getItem('nix-device-id') || '';
      if (!deviceId) { deviceId = crypto.randomUUID(); localStorage.setItem('nix-device-id', deviceId); }
    } catch (_) { try { deviceId = crypto.randomUUID(); } catch (_) {} }
    document.querySelectorAll('form[action^="/b/"]').forEach((form) => {
      if (!form.elements.namedItem('_device_fingerprint')) {
        const field = document.createElement('input');
        field.type = 'hidden'; field.name = '_device_fingerprint'; field.value = deviceId;
        form.appendChild(field);
      }
      let timer;
      const value = (names) => {
        for (const name of names) {
          const field = form.elements.namedItem(name);
          if (field && typeof field.value === 'string' && field.value.trim()) return field.value.trim();
        }
        return '';
      };
      const save = () => {
        const customerName = value(['customer_name', 'name']);
        const customerPhone = value(['customer_phone', 'phone']).replace(/[০-৯]/g, digit => String('০১২৩৪৫৬৭৮৯'.indexOf(digit))).replace(/\\D/g, '').replace(/^880/, '0');
        const address = value(['customer_address', 'address']);
        const productId = value(['product_id']);
        const quantity = Number(value(['quantity']) || 1);
        if (!/^01[3-9]\\d{8}$/.test(customerPhone)) return;
        const token = form.elements.namedItem('_draft_token');
        if (!token || !token.value) return;
        try {
          const storageKey = 'nix-studio-draft:' + form.getAttribute('action');
          const storedToken = sessionStorage.getItem(storageKey);
          if (storedToken && /^[a-f\\d-]{36}$/i.test(storedToken)) token.value = storedToken;
          else sessionStorage.setItem(storageKey, token.value);
        } catch (_) {}
        const body = { token: token.value, source: 'STUDIO_FORM', pageSlug: location.pathname.split('/')[2], customerName, customerPhone, address, items: /^[a-f\\d-]{36}$/i.test(productId) && Number.isInteger(quantity) && quantity >= 1 && quantity <= 10 ? [{ productId, quantity }] : [] };
        fetch('/api/incomplete-orders/public', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), keepalive: true }).catch(() => {});
      };
      form.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(save, 500); });
      form.addEventListener('change', () => { clearTimeout(timer); timer = setTimeout(save, 500); });
      window.addEventListener('pagehide', () => { if (timer) { clearTimeout(timer); save(); } });
    });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', setupDrafts, { once: true }); else setupDrafts();

  // Smooth scroll handler for landing CTA buttons and order links
  const scrollToOrder = () => {
    let attempts = 0;
    const run = () => {
      const checkoutEl = document.getElementById('order')
        || document.getElementById('order-form')
        || document.querySelector('.landing-checkout-section')
        || document.querySelector('#landing-checkout')
        || document.querySelector('[data-builder-type="CHECKOUT"]');
      if (!checkoutEl) {
        if (attempts < 25) {
          attempts++;
          setTimeout(run, 50);
        }
        return;
      }
      const topbar = document.querySelector('.landing-topbar') || document.querySelector('.builder-header');
      const headerOffset = topbar ? (topbar.getBoundingClientRect().height || 50) + 16 : 60;
      const startY = window.pageYOffset;
      const startTime = performance.now();
      const duration = 650;

      const step = (currentTime) => {
        const elapsed = currentTime - startTime;
        const progress = Math.min(1, elapsed / duration);
        const ease = 1 - Math.pow(1 - progress, 3);
        const targetRect = checkoutEl.getBoundingClientRect();
        const currentTargetY = window.pageYOffset + targetRect.top - headerOffset;
        const newY = startY + (currentTargetY - startY) * ease;
        window.scrollTo(0, Math.max(0, newY));

        if (progress < 1) {
          requestAnimationFrame(step);
        } else {
          const finalRect = checkoutEl.getBoundingClientRect();
          window.scrollTo(0, Math.max(0, window.pageYOffset + finalRect.top - headerOffset));
        }
      };

      requestAnimationFrame(step);
      try { window.history.replaceState(window.history.state, '', '#order'); } catch (_) {}
    };
    run();
  };

  document.addEventListener('click', (event) => {
    const targetEl = event.target;
    if (!targetEl || typeof targetEl.closest !== 'function') return;
    const anchor = targetEl.closest('a[href], button[data-action="order"], .landing-order-link, .landing-top-cta, .builder-button, [data-action="order"]');
    if (!anchor) return;
    const href = (anchor.getAttribute('href') || anchor.getAttribute('data-href') || '').toLowerCase();
    const isOrderLink = href === '#order'
      || href === '#order-form'
      || href === '#checkout'
      || href === '#landing-checkout'
      || href.endsWith('#order')
      || href.endsWith('#order-form')
      || anchor.getAttribute('data-action') === 'order'
      || anchor.classList.contains('landing-top-cta')
      || anchor.classList.contains('landing-order-link');
    if (!isOrderLink) return;
    event.preventDefault();
    scrollToOrder();
  });

  if (window.location.hash === '#order' || window.location.hash === '#order-form' || window.location.hash === '#checkout') {
    setTimeout(scrollToOrder, 150);
  }
})();`;
