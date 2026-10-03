/** Same-document company windows. No network, storage or globe bridge. */
const triggers = [...document.querySelectorAll('[data-window]')];
const windows = new Map([...document.querySelectorAll('dialog.window')].map(el => [el.id, el]));
const returnTo = new WeakMap();

function focusable(dialog) {
  return [...dialog.querySelectorAll('a[href], button:not([disabled]), [tabindex="0"]')]
    .filter(el => el.getClientRects().length > 0);
}

function openWindow(id, trigger) {
  const dialog = windows.get(id);
  if (!dialog || typeof dialog.showModal !== 'function') return false;
  if (dialog.open) return true;
  for (const other of windows.values()) if (other.open) other.close();
  returnTo.set(dialog, trigger);
  dialog.showModal();
  dialog.scrollTop = 0;
  dialog.querySelector('[data-close]')?.focus({ preventScroll: true });
  return true;
}

if ([...windows.values()].every(dialog => typeof dialog.showModal === 'function')) {
  document.documentElement.classList.add('windows-ready');
  for (const trigger of triggers) {
    trigger.addEventListener('click', event => {
      if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      if (openWindow(trigger.dataset.window, trigger)) event.preventDefault();
    });
  }
  for (const dialog of windows.values()) {
    dialog.querySelector('[data-close]')?.addEventListener('click', event => {
      event.preventDefault();
      dialog.close();
    });
    dialog.addEventListener('close', () => {
      const trigger = returnTo.get(dialog);
      if (trigger?.isConnected && ![...windows.values()].some(window => window.open)) trigger.focus({ preventScroll: true });
    });
    // Escape uses native dialog cancellation. Tab stays inside the window,
    // including at the last link, rather than entering the globe iframe.
    dialog.addEventListener('keydown', event => {
      if (event.key !== 'Tab') return;
      const elements = focusable(dialog);
      const first = elements[0], last = elements.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault(); last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault(); first?.focus();
      }
    });
  }
  const initial = location.hash.slice(1);
  const trigger = triggers.find(el => el.dataset.window === initial);
  if (trigger) openWindow(initial, trigger);
}
