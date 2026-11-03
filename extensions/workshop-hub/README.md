# Workshop Hub extension

A read-only panel that lists every workshop in the
[multi-lora](https://github.com/rashmijain02/multi-lora) repository. For each one it shows an
overview, the docs, commands to copy, and ready-made prompts for the chat box.

- Data comes from the Workshop Hub sidecar (`ux-workspace/hub/hub_sidecar.py` in multi-lora)
  on `http://127.0.0.1:8766`, through WebUI's fixed proxy path
  `api/extensions/workshop-hub/sidecar/...` with `proxy_auth: token-v1`.
- It never runs commands and never sends chat messages.
- It is loaded through `../multilora-manifest.json`, which also lists the Workshop 5
  `personadesk` Workbench. WebUI reads one manual manifest, so both must be listed there.

Start it from the multi-lora repository root with:

```powershell
python ux-workspace/scripts/start_workspace.py
```

See `ux-workspace/README.md` and `ux-workspace/PLAN.md` in multi-lora for the full design.
