/*
 * Workshop Hub (multi-lora UX workspace).
 *
 * One panel that lists every workshop in the repository and shows its overview, docs,
 * commands and ready-made Hermes prompts. All data comes from the Workshop Hub sidecar
 * through WebUI's fixed, same-origin proxy path, which injects the token-v1 secret.
 *
 * Read only by design: commands are shown for copying and never run, and prompts are only
 * placed in the chat box. The learner always presses Send.
 *
 * innerHTML is used in exactly one place: output of WebUI's own renderMd(), which escapes
 * raw HTML. Everything else is built with DOM APIs and textContent.
 */
(() => {
  'use strict';

  const EXT_ID = 'workshop-hub';
  const ROOT_ID = 'workshop-hub';
  if (document.getElementById(ROOT_ID)) return;

  // Mount-relative (no leading slash) so it works behind a reverse-proxy subpath.
  const SIDECAR = 'api/extensions/' + EXT_ID + '/sidecar';
  const ext = window.hermesExt && typeof window.hermesExt.register === 'function'
    ? window.hermesExt.register(EXT_ID)
    : null;
  const settings = ext ? ext.settings : null;
  const storage = ext ? ext.storage : null;

  const STATUS_HELP = {
    401: 'The sidecar rejected the proxy token. Restart it with the same HERMES_WEBUI_STATE_DIR as WebUI (start_workspace.py does this for you).',
    403: 'Sidecar proxy not allowed yet. Set a WebUI password, then grant proxy consent for "workshop-hub" in Settings → Extensions.',
    404: 'Not found.',
    413: 'That document is too large to show here. Open it in your editor.',
    502: 'WebUI could not reach the Workshop Hub sidecar. Start it with ux-workspace/scripts/start_workspace.py.',
    503: 'The sidecar is waiting for proxy consent. Grant it for "workshop-hub" in Settings → Extensions.',
    504: 'The sidecar did not answer in time.',
  };
  const KIND_TITLES = { setup: 'Set up', check: 'Check it works', try: 'Try it' };
  const TABS = [
    { id: 'overview', title: 'Overview' },
    { id: 'docs', title: 'Docs' },
    { id: 'run', title: 'Run' },
    { id: 'ask', title: 'Ask Hermes' },
  ];

  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    Object.entries(attrs || {}).forEach(([key, value]) => {
      if (value === undefined || value === null || value === false) return;
      if (key === 'text') node.textContent = String(value);
      else if (key === 'className') node.className = value;
      else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
      else node.setAttribute(key, value === true ? '' : String(value));
    });
    (children || []).forEach((child) => child && node.appendChild(child));
    return node;
  }

  function msg(text, isError) {
    return el('p', { className: isError ? 'wh-msg wh-msg-error' : 'wh-msg', text });
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

  // ---- state --------------------------------------------------------------------------------
  const state = {
    list: [],
    errors: [],
    current: null, // full detail of the selected workshop
    tab: (storage && storage.get('lastTab')) || 'overview',
    doc: null,
  };

  // ---- shell --------------------------------------------------------------------------------
  const listNav = el('nav', { className: 'wh-list', 'aria-label': 'Workshops' });
  const errorBox = el('div', { className: 'wh-errors', hidden: true });
  const heading = el('div', { className: 'wh-heading' });
  const tabBar = el('div', { className: 'wh-tabs', role: 'tablist', 'aria-label': 'Workshop sections' });
  const body = el('div', { className: 'wh-body', role: 'tabpanel', 'aria-live': 'polite' });
  const refreshBtn = el('button', { type: 'button', className: 'wh-icon-btn', 'aria-label': 'Refresh', title: 'Refresh', text: '↻' });
  const closeBtn = el('button', { type: 'button', className: 'wh-icon-btn', 'aria-label': 'Close Workshop Hub', title: 'Close (Esc)', text: '×' });

  const root = el('section', { id: ROOT_ID, className: 'wh-root', 'aria-label': 'Workshop Hub', hidden: true }, [
    el('header', { className: 'wh-topbar' }, [
      el('div', {}, [
        el('h2', { className: 'wh-title', text: 'Workshop Hub' }),
        el('p', { className: 'wh-subtitle', text: 'Every workshop in this repository, in learning-path order.' }),
      ]),
      el('div', { className: 'wh-actions' }, [refreshBtn, closeBtn]),
    ]),
    el('div', { className: 'wh-layout' }, [
      el('aside', { className: 'wh-side' }, [listNav, errorBox]),
      el('div', { className: 'wh-main' }, [heading, tabBar, body]),
    ]),
  ]);

  const toggle = el('button', {
    type: 'button', id: 'wh-toggle', className: 'wh-toggle',
    'aria-controls': ROOT_ID, 'aria-expanded': 'false', text: 'Workshops',
  });

  function setOpen(open) {
    root.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
    if (open && !state.list.length) loadList();
  }

  // ---- list ---------------------------------------------------------------------------------
  function statusChip(status) {
    return el('span', { className: 'wh-chip wh-status-' + status, text: status });
  }

  function renderList() {
    listNav.replaceChildren();
    if (!state.list.length) {
      listNav.appendChild(msg('No workshops found yet.'));
    }
    state.list.forEach((w) => {
      const selected = state.current && state.current.id === w.id;
      listNav.appendChild(el('button', {
        type: 'button',
        className: 'wh-item' + (selected ? ' wh-item-selected' : ''),
        'aria-current': selected ? 'true' : null,
        onclick: () => selectWorkshop(w.id),
      }, [
        el('span', { className: 'wh-item-label', text: w.label }),
        el('span', { className: 'wh-item-title', text: w.title }),
        el('span', { className: 'wh-item-meta' }, [
          statusChip(w.status),
          w.optional ? el('span', { className: 'wh-chip', text: 'optional' }) : null,
        ]),
      ]));
    });
    errorBox.replaceChildren();
    errorBox.hidden = !state.errors.length;
    if (state.errors.length) {
      errorBox.appendChild(el('h3', { text: 'Manifests with problems' }));
      state.errors.forEach((e) => {
        errorBox.appendChild(el('div', { className: 'wh-error' }, [
          el('code', { text: e.manifest }),
          el('ul', {}, e.errors.map((line) => el('li', { text: line }))),
        ]));
      });
    }
  }

  async function loadList() {
    listNav.replaceChildren(msg('Loading…'));
    try {
      const data = await getJson('/v1/workshops');
      state.list = data.workshops || [];
      state.errors = data.errors || [];
    } catch (err) {
      state.list = [];
      state.errors = [];
      listNav.replaceChildren(msg(err.message, true));
      heading.replaceChildren();
      tabBar.replaceChildren();
      body.replaceChildren();
      return;
    }
    renderList();
    const remembered = storage ? storage.get('lastWorkshop') : null;
    const pick = state.list.find((w) => w.id === remembered) || state.list[0];
    if (pick) selectWorkshop(pick.id);
  }

  // ---- detail -------------------------------------------------------------------------------
  async function selectWorkshop(id) {
    body.replaceChildren(msg('Loading…'));
    try {
      state.current = await getJson('/v1/workshops/' + encodeURIComponent(id));
    } catch (err) {
      body.replaceChildren(msg(err.message, true));
      return;
    }
    state.doc = null;
    if (storage) storage.set('lastWorkshop', id);
    renderList();
    renderHeading();
    showTab(state.tab);
  }

  function renderHeading() {
    const w = state.current;
    heading.replaceChildren(
      el('p', { className: 'wh-kicker', text: w.label }),
      el('h3', { className: 'wh-workshop-title', text: w.title }),
      el('p', { className: 'wh-item-meta' }, [
        statusChip(w.status),
        w.optional ? el('span', { className: 'wh-chip', text: 'optional' }) : null,
      ]),
    );
  }

  function showTab(tabId) {
    if (!TABS.some((t) => t.id === tabId)) tabId = 'overview';
    state.tab = tabId;
    if (storage) storage.set('lastTab', tabId);
    tabBar.replaceChildren(...TABS.map((t) => el('button', {
      type: 'button', role: 'tab', className: 'wh-tab',
      'aria-selected': String(t.id === tabId),
      onclick: () => showTab(t.id),
      text: t.title,
    })));
    body.replaceChildren();
    if (!state.current) return;
    if (tabId === 'overview') renderOverview();
    else if (tabId === 'docs') renderDocs();
    else if (tabId === 'run') renderRun();
    else renderAsk();
  }

  function row(label, valueNode) {
    return [el('dt', { text: label }), el('dd', {}, [valueNode])];
  }

  function renderOverview() {
    const w = state.current;
    const byId = Object.fromEntries(state.list.map((x) => [x.id, x]));
    const buildsOn = w.builds_on.length
      ? el('span', {}, w.builds_on.map((id) => el('button', {
        type: 'button', className: 'wh-link-btn',
        text: byId[id] ? byId[id].label + ': ' + byId[id].title : id,
        onclick: () => selectWorkshop(id),
      })))
      : document.createTextNode('Nothing: you can start here.');
    const ready = w.readiness.length
      ? el('ul', { className: 'wh-ready' }, w.readiness.map((r) => el('li', {
        className: r.present ? 'wh-ok' : 'wh-missing',
      }, [
        el('span', { className: 'wh-ready-mark', 'aria-hidden': 'true', text: r.present ? '✓' : '○' }),
        el('span', { text: r.label + ' ' }),
        el('code', { text: r.path }),
        el('span', { className: 'wh-sr', text: r.present ? ' (present)' : ' (missing)' }),
      ])))
      : document.createTextNode('No readiness checks declared.');
    body.append(
      el('p', { className: 'wh-summary', text: w.summary }),
      el('dl', { className: 'wh-facts' }, [
        ...row('Hardware', document.createTextNode(w.hardware)),
        ...row('Folder', el('code', { text: w.folder })),
        ...row('Builds on', buildsOn),
        ...row('Extra WebUI parts', document.createTextNode(w.extensions.length ? w.extensions.join(', ') : 'None')),
      ]),
      el('h4', { text: 'Ready on this machine?' }),
      ready,
      el('p', { className: 'wh-meta', text: 'Missing items usually mean a setup step has not run yet. See the Run tab.' }),
    );
  }

  // ---- docs ---------------------------------------------------------------------------------
  function joinPosix(baseFile, rel) {
    const parts = baseFile.split('/').slice(0, -1);
    rel.split('/').forEach((p) => {
      if (p === '' || p === '.') return;
      if (p === '..') parts.pop();
      else parts.push(p);
    });
    return parts.join('/');
  }

  function safeDecode(value) {
    try { return decodeURI(value); } catch (err) { return value; }
  }

  // renderMd (built for chat) links only URLs with a scheme and keeps every newline as a line
  // break. Before rendering a doc we (1) join soft-wrapped lines, (2) park relative links behind
  // a sentinel https URL so renderMd turns them into anchors that tameLinks() then routes, and
  // (3) turn relative images into text. Code fences and inline code are left untouched.
  const HUB_LINK = 'https://workshop-hub.invalid/link/';
  const BLOCK_START = /^\s*(#{1,6}\s|>|\||[-*+]\s|\d+[.)]\s|```|~~~|<|---|\*\*\*|___|$)/;

  function rewriteInline(text) {
    const spans = [];
    const masked = text.replace(/(`+)[^`]*?\1/g, (m) => { spans.push(m); return '\u0001' + (spans.length - 1) + '\u0001'; });
    return masked
      .replace(/!\[([^\]]*)\]\((?!https?:|data:)([^)\s]+)\)/g, (_, alt, src) => '[image: ' + (alt || src) + ']')
      .replace(/(^|[^!])\[([^\]]+)\]\((?![a-z][a-z0-9+.-]*:)([^)\s]+)\)/gi,
        (_, pre, label, target) => pre + '[' + label + '](' + HUB_LINK + encodeURIComponent(target) + ')')
      .replace(/\u0001(\d+)\u0001/g, (_, i) => spans[Number(i)]);
  }

  function prepareMarkdown(markdown) {
    const out = [];
    let fence = null;
    let joinable = false;
    markdown.replace(/\r\n?/g, '\n').split('\n').forEach((line) => {
      const marker = line.match(/^\s*(```|~~~)/);
      if (fence) {
        out.push(line);
        if (marker && marker[1] === fence) fence = null;
        return;
      }
      if (marker) { fence = marker[1]; joinable = false; out.push(line); return; }
      const text = rewriteInline(line);
      const plain = !BLOCK_START.test(line) && !/^ {4,}\S/.test(line);
      if (joinable && plain && out.length) out[out.length - 1] += ' ' + text.trim();
      else out.push(text);
      const hardBreak = / {2}$|\\$/.test(line);
      joinable = line.trim() !== '' && !/^\s*(#{1,6}\s|\||```|~~~|<)/.test(line) && !hardBreak;
    });
    return out.join('\n');
  }

  // Keep the reader inside the hub: declared docs open here, web links open in a new tab,
  // and every other relative link or image becomes plain text instead of a broken request.
  function tameLinks(container, docPath) {
    const declared = new Set(state.current.docs.map((d) => d.path));
    container.querySelectorAll('a[href]').forEach((a) => {
      let href = a.getAttribute('href') || '';
      if (href.startsWith(HUB_LINK)) {
        try { href = decodeURIComponent(href.slice(HUB_LINK.length)); } catch (err) { href = ''; }
      } else if (/^https?:\/\//i.test(href)) {
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        return;
      }
      const target = href.startsWith('#') ? '' : joinPosix(docPath, safeDecode(href.split('#')[0]));
      a.removeAttribute('href');
      if (declared.has(target)) {
        a.className = 'wh-doc-link';
        a.setAttribute('role', 'link');
        a.tabIndex = 0;
        const open = () => openDoc(target);
        a.addEventListener('click', open);
        a.addEventListener('keydown', (e) => { if (e.key === 'Enter') open(); });
      } else {
        a.className = 'wh-dead-link';
        a.title = href.startsWith('#') ? 'Section link' : 'Open ' + (target || href) + ' in your editor';
      }
    });
    container.querySelectorAll('img').forEach((img) => {
      const src = img.getAttribute('src') || '';
      if (!/^https?:\/\//i.test(src)) img.replaceWith(document.createTextNode('[image: ' + (img.alt || src) + ']'));
    });
  }

  function renderDocs() {
    const w = state.current;
    const picker = el('div', { className: 'wh-doc-picker', role: 'list' }, w.docs.map((d) => el('button', {
      type: 'button', role: 'listitem', className: 'wh-doc-btn',
      'aria-current': state.doc === d.path ? 'true' : null,
      onclick: () => openDoc(d.path),
      text: d.title,
    })));
    const view = el('article', { className: 'wh-doc', id: 'wh-doc-view' });
    body.append(picker, view);
    openDoc(state.doc || w.docs[0].path);
  }

  async function openDoc(path) {
    state.doc = path;
    if (state.tab !== 'docs') { showTab('docs'); return; }
    body.querySelectorAll('.wh-doc-btn').forEach((b, i) => {
      if (state.current.docs[i].path === path) b.setAttribute('aria-current', 'true');
      else b.removeAttribute('aria-current');
    });
    const view = body.querySelector('#wh-doc-view');
    if (!view) return;
    view.replaceChildren(msg('Loading…'));
    let doc;
    try {
      doc = await getJson('/v1/workshops/' + encodeURIComponent(state.current.id) + '/doc?path=' + encodeURIComponent(path));
    } catch (err) {
      view.replaceChildren(msg(err.message, true));
      return;
    }
    if (state.doc !== path) return; // a newer click won
    const source = el('p', { className: 'wh-meta' }, [
      document.createTextNode('File: '),
      el('code', { text: state.current.folder + '/' + doc.path }),
    ]);
    const content = el('div', { className: 'wh-md' });
    let rendered = null;
    if (typeof window.renderMd === 'function') {
      try { rendered = window.renderMd(prepareMarkdown(doc.markdown)); } catch (err) { rendered = null; }
    }
    if (typeof rendered === 'string') {
      content.innerHTML = rendered; // renderMd escapes raw HTML (same path as chat messages)
      tameLinks(content, doc.path);
    } else {
      content.appendChild(el('pre', { className: 'wh-plain', text: doc.markdown }));
    }
    view.replaceChildren(source, content);
    body.scrollTop = 0;
  }

  // ---- run ----------------------------------------------------------------------------------
  async function copyText(text, button) {
    try {
      await navigator.clipboard.writeText(text);
      button.textContent = 'Copied';
    } catch (err) {
      button.textContent = 'Copy failed: select the text';
    }
    setTimeout(() => { button.textContent = 'Copy'; }, 1500);
  }

  function renderRun() {
    const w = state.current;
    body.appendChild(el('p', { className: 'wh-meta', text: 'Commands come from the workshop README. The hub never runs them: copy one into a terminal opened at the folder shown.' }));
    if (!w.commands.length) { body.appendChild(msg('No commands declared.')); return; }
    Object.keys(KIND_TITLES).forEach((kind) => {
      const cmds = w.commands.filter((c) => c.kind === kind);
      if (!cmds.length) return;
      body.appendChild(el('h4', { text: KIND_TITLES[kind] }));
      cmds.forEach((c) => {
        const copy = el('button', { type: 'button', className: 'wh-copy', text: 'Copy' });
        copy.addEventListener('click', () => copyText(c.run, copy));
        body.appendChild(el('div', { className: 'wh-cmd' }, [
          el('div', { className: 'wh-cmd-head' }, [
            el('strong', { text: c.label }),
            el('span', { className: 'wh-meta', text: 'in ' + (c.cwd === '.' ? 'the repository root' : c.cwd) }),
            copy,
          ]),
          el('pre', {}, [el('code', { text: c.run })]),
          c.note ? el('p', { className: 'wh-meta', text: c.note }) : null,
        ]));
      });
    });
  }

  // ---- ask ----------------------------------------------------------------------------------
  function putInComposer(text) {
    const box = document.getElementById('msg');
    if (!box) return false;
    box.value = text;
    box.dispatchEvent(new Event('input', { bubbles: true }));
    setOpen(false);
    box.focus();
    return true;
  }

  function renderAsk() {
    const w = state.current;
    body.appendChild(el('p', { className: 'wh-meta', text: 'A prompt goes into the chat box. Read it, change it if you like, then press Send yourself.' }));
    if (!w.prompts.length) { body.appendChild(msg('No prompts declared for this workshop.')); return; }
    w.prompts.forEach((p) => {
      const status = el('span', { className: 'wh-meta' });
      body.appendChild(el('div', { className: 'wh-prompt' }, [
        el('div', { className: 'wh-cmd-head' }, [
          el('strong', { text: p.label }),
          el('button', {
            type: 'button', className: 'wh-copy', text: 'Put in chat box',
            onclick: () => { if (!putInComposer(p.prompt)) status.textContent = 'Chat box not found; open a chat first.'; },
          }),
        ]),
        el('p', { text: p.prompt }),
        status,
      ]));
    });
  }

  // ---- wiring -------------------------------------------------------------------------------
  toggle.addEventListener('click', () => setOpen(root.hidden));
  closeBtn.addEventListener('click', () => setOpen(false));
  refreshBtn.addEventListener('click', () => { state.list = []; loadList(); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !root.hidden) setOpen(false);
  });

  document.body.appendChild(toggle);
  document.body.appendChild(root);
  if (settings && settings.get('open_on_load') === true) setOpen(true);
})();
