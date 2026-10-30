/*
 * PersonaDesk Workbench (multi-lora Workshop 5).
 *
 * A read-only drawer beside WebUI's own chat. All data comes from the PersonaDesk sidecar
 * through WebUI's fixed, same-origin proxy path, which injects the token-v1 secret. This
 * script never sees or stores that token, never writes persona data to browser storage,
 * and has no approve/reject buttons: reviews stay in the PersonaDesk review commands so
 * the UI adds no write path around the guard.
 */
(() => {
  'use strict';

  const EXT_ID = 'personadesk';
  const ROOT_ID = 'pd-workbench';
  if (document.getElementById(ROOT_ID)) return;

  // Mount-relative (no leading slash) so it works behind a reverse-proxy subpath.
  const SIDECAR = 'api/extensions/' + EXT_ID + '/sidecar';
  const ext = window.hermesExt && typeof window.hermesExt.register === 'function'
    ? window.hermesExt.register(EXT_ID)
    : null;
  const settings = ext ? ext.settings : null;
  const storage = ext ? ext.storage : null;

  const STATUS_HELP = {
    401: 'The sidecar rejected the proxy token. Restart the sidecar with the same HERMES_WEBUI_STATE_DIR as WebUI.',
    403: 'Sidecar proxy not allowed yet. Set a WebUI password, then grant proxy consent for "personadesk" in Settings → Extensions.',
    404: 'Not found.',
    502: 'WebUI could not reach the sidecar. Is it running on the port in manifest.json?',
    503: 'The sidecar is not ready: either the proxy token has not been minted yet (grant consent) or the PersonaDesk state database is missing.',
    504: 'The sidecar did not answer in time.',
  };

  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    Object.entries(attrs || {}).forEach(([key, value]) => {
      if (value === undefined || value === null) return;
      if (key === 'text') node.textContent = String(value);
      else if (key === 'className') node.className = value;
      else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
      else node.setAttribute(key, String(value));
    });
    (children || []).forEach((child) => child && node.appendChild(child));
    return node;
  }

  async function getJson(path) {
    let resp;
    try {
      resp = await fetch(SIDECAR + path, {
        method: 'GET',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { Accept: 'application/json' },
      });
    } catch (err) {
      throw new Error('Network error while contacting WebUI.');
    }
    if (!resp.ok) {
      throw new Error(STATUS_HELP[resp.status] || ('Sidecar request failed (HTTP ' + resp.status + ').'));
    }
    return resp.json();
  }

  // ---- shell ------------------------------------------------------------------------
  const tabs = el('nav', { className: 'pd-tabs', role: 'tablist', 'aria-label': 'Workbench panels' });
  const body = el('div', { className: 'pd-body', role: 'tabpanel', 'aria-live': 'polite' });
  const title = el('h2', { className: 'pd-title', text: 'Workbench' });
  const subtitle = el('p', { className: 'pd-subtitle', text: 'PersonaDesk' });
  const refreshBtn = el('button', { type: 'button', className: 'pd-icon-btn', 'aria-label': 'Refresh', title: 'Refresh', text: '↻' });
  const closeBtn = el('button', { type: 'button', className: 'pd-icon-btn', 'aria-label': 'Close Workbench', title: 'Close', text: '×' });
  const drawer = el('aside', { id: ROOT_ID, className: 'pd-workbench', 'aria-label': 'PersonaDesk Workbench', hidden: '' }, [
    el('header', { className: 'pd-header' }, [
      el('div', {}, [title, subtitle]),
      el('div', { className: 'pd-actions' }, [refreshBtn, closeBtn]),
    ]),
    tabs,
    body,
    el('footer', { className: 'pd-footer', text: 'Read-only. Approve or reject drafts with the PersonaDesk review command.' }),
  ]);
  const toggle = el('button', {
    type: 'button', id: 'pd-workbench-toggle', className: 'pd-toggle',
    'aria-controls': ROOT_ID, 'aria-expanded': 'false', text: 'Workbench',
  });

  let layout = null;
  let current = null;

  function setOpen(open) {
    drawer.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
    if (open && !layout) load();
  }

  function message(text, kind) {
    body.replaceChildren(el('p', { className: 'pd-msg' + (kind ? ' pd-msg-' + kind : ''), text }));
  }

  // ---- panels -----------------------------------------------------------------------
  function table(headers, rows) {
    return el('table', { className: 'pd-table' }, [
      el('thead', {}, [el('tr', {}, headers.map((h) => el('th', { scope: 'col', text: h })))]),
      el('tbody', {}, rows.map((r) => el('tr', {}, r.map((c) => el('td', { text: c === null || c === undefined ? '—' : c }))))),
    ]);
  }

  function statusChip(status) {
    return el('span', { className: 'pd-chip pd-status-' + String(status).replace(/[^a-z_]/g, ''), text: String(status).replace(/_/g, ' ') });
  }

  const renderers = {
    async 'work-queue'() {
      const data = await getJson('/v1/queue');
      if (!data.jobs.length) return el('p', { className: 'pd-msg', text: 'No jobs yet.' });
      const rows = data.jobs.map((j) => el('tr', {}, [
        el('td', { text: j.fixture_id }),
        el('td', { text: j.task.replace(/_/g, ' ') }),
        el('td', {}, [statusChip(j.status)]),
        el('td', { text: (j.updated_at || '').replace('T', ' ').slice(0, 16) }),
      ]));
      return el('table', { className: 'pd-table' }, [
        el('thead', {}, [el('tr', {}, ['Fixture', 'Task', 'Status', 'Updated (UTC)'].map((h) => el('th', { scope: 'col', text: h })))]),
        el('tbody', {}, rows),
      ]);
    },
    async 'draft-review'() {
      const data = await getJson('/v1/drafts');
      if (!data.drafts.length) return el('p', { className: 'pd-msg', text: 'Nothing is awaiting review.' });
      return el('div', { className: 'pd-cards' }, data.drafts.map((d) => el('article', { className: 'pd-card' }, [
        el('h3', { text: d.fixture_id + ' · revision ' + d.revision }),
        el('pre', { className: 'pd-draft', text: d.body }),
        d.uncertainties.length ? el('div', {}, [
          el('h4', { text: 'Uncertainties' }),
          el('ul', {}, d.uncertainties.map((u) => el('li', { text: u }))),
        ]) : null,
        el('h4', { text: 'Blocked for this persona' }),
        el('p', { className: 'pd-blocked' }, d.blocked_actions.map((a) => el('span', { className: 'pd-chip pd-chip-blocked', text: a }))),
        el('p', { className: 'pd-meta', text: 'Job ' + d.job_id + ' · hash ' + String(d.artifact_hash).slice(0, 12) }),
      ])));
    },
    async 'evidence-table'() {
      const data = await getJson('/v1/evidence');
      if (!data.evidence.length) return el('p', { className: 'pd-msg', text: 'No evidence on drafts awaiting review.' });
      return table(['Fixture', 'Kind', 'Source'], data.evidence.map((e) => [e.fixture_id, e.kind, e.source_id]));
    },
  };

  async function show(panelId) {
    const panel = layout.panels.find((p) => p.id === panelId) || layout.panels[0];
    current = panel.id;
    if (storage) storage.set('lastPanel', panel.id);
    tabs.querySelectorAll('button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.panel === panel.id)));
    if (!panel.available || !renderers[panel.id]) {
      body.replaceChildren(el('div', { className: 'pd-planned' }, [
        el('h3', { text: panel.title }),
        el('p', { text: 'Not available yet. ' + (panel.reason || '') }),
        panel.advisory ? el('p', { className: 'pd-advisory', text: 'Advisory, not verified.' }) : null,
      ]));
      return;
    }
    message('Loading…');
    try {
      const node = await renderers[panel.id]();
      if (current === panel.id) body.replaceChildren(node);
    } catch (err) {
      if (current === panel.id) message(err.message, 'error');
    }
  }

  async function load() {
    message('Loading layout…');
    try {
      layout = (await getJson('/v1/layout')).layout;
    } catch (err) {
      layout = null;
      message(err.message, 'error');
      return;
    }
    drawer.dataset.persona = layout.persona;
    drawer.dataset.density = layout.style.density;
    drawer.dataset.font = layout.style.font;
    drawer.dataset.contrast = layout.style.contrast;
    if (/^#[0-9a-fA-F]{6}$/.test(layout.style.accent)) drawer.style.setProperty('--pd-accent', layout.style.accent);
    title.textContent = layout.display_name;
    subtitle.textContent = layout.role + ' · Workbench';
    tabs.replaceChildren(...layout.panels.map((p) => el('button', {
      type: 'button', role: 'tab', className: 'pd-tab' + (p.available ? '' : ' pd-tab-planned'),
      'data-panel': p.id, 'aria-selected': 'false', text: p.title,
      onclick: () => show(p.id),
    })));
    const remembered = storage ? storage.get('lastPanel') : null;
    show(layout.panels.some((p) => p.id === remembered) ? remembered : layout.default_panel);
  }

  toggle.addEventListener('click', () => setOpen(drawer.hidden));
  closeBtn.addEventListener('click', () => setOpen(false));
  refreshBtn.addEventListener('click', () => (layout ? show(current) : load()));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !drawer.hidden) setOpen(false);
  });

  if (ext && ext.events) {
    ext.events.on('turn:complete', () => {
      const wanted = settings ? settings.get('refresh_after_turn') !== false : true;
      if (wanted && layout && !drawer.hidden) show(current);
    });
  }

  document.body.appendChild(toggle);
  document.body.appendChild(drawer);
  if (settings && settings.get('open_on_load') === true) setOpen(true);
})();
