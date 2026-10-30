# PersonaDesk Workbench extension

A read-only drawer that sits beside WebUI's own chat and shows one PersonaDesk persona's
work queue, drafts awaiting review, and the evidence those drafts cite. It is part of
Workshop 5 in the `multi-lora` learning repository (`workshops/persona-portal/`).

- **Layout:** comes from the sidecar's `/v1/layout`, which reads the persona's
  `ux/<persona-id>.json`. One extension, ten layouts.
- **Data:** comes only through WebUI's fixed proxy path
  `api/extensions/personadesk/sidecar/v1/...`. WebUI adds the `token-v1` header; this
  script never sees the token.
- **Read-only:** there are no approve or reject buttons. Reviews stay in the PersonaDesk
  review command, so the UI adds no write path around the guard.
- **Storage:** only the last opened panel id and the two settings in `manifest.json`.
  No persona data and no tokens are stored in the browser.

## Run locally

Paths below are relative to the fork checkout (`external/hermes-webui` in `multi-lora`).
Use isolated state directories so your real Hermes home is untouched.

1. Start the sidecar (see `workshops/persona-portal/README.md` in `multi-lora`) on
   `127.0.0.1:8765`, with the same `HERMES_WEBUI_STATE_DIR` you give WebUI.
2. Start WebUI with authentication on (`token-v1` returns 403 while auth is off) and this
   directory as the extension source:

   ```bash
   HERMES_WEBUI_PASSWORD=<choose-one> \
   HERMES_WEBUI_STATE_DIR=<isolated-state-dir> \
   HERMES_WEBUI_EXTENSION_DIR=extensions \
   HERMES_WEBUI_EXTENSION_MANIFEST=personadesk/manifest.json \
   ./start.sh
   ```

3. Sign in, open **Settings → Extensions**, and grant sidecar proxy consent for
   `personadesk`. WebUI then mints the token file the sidecar reads.
4. Click **Workbench** (top right).

## Files

| File | Purpose |
|---|---|
| `manifest.json` | Assets, settings and the loopback sidecar declaration (`proxy_auth: token-v1`) |
| `personadesk.js` | Drawer, tabs and panel renderers (DOM via `textContent` only) |
| `personadesk.css` | Styles scoped to `#pd-workbench`, driven by the layout's style tokens |
