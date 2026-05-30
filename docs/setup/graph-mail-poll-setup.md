# Setup — live MS Graph mail poll (read-only, single mailbox)

One-time setup so the agent can read `alwyn@northscale.studio`'s "Quote requests" folder.
Secrets go in `.env` (gitignored) — never commit them.

## 1. Register the app (Microsoft Entra admin center)
1. **App registrations → New registration** → name `QuoteAgent Mail Poll`, single tenant → Register.
2. Copy **Application (client) ID** → `GRAPH_CLIENT_ID`, and **Directory (tenant) ID** → `GRAPH_TENANT_ID`.
3. **Certificates & secrets → New client secret** → copy the **Value** (shown once) → `GRAPH_CLIENT_SECRET`.
4. **API permissions → Add a permission → Microsoft Graph → Application permissions → `Mail.Read`** → Add.
   (Do NOT add `Mail.Send` or `Mail.ReadWrite` — Scope A is read-only.)
5. **Grant admin consent for <tenant>** → the `Mail.Read` row shows **Granted**.

## 2. Restrict the app to ONE mailbox (Exchange Online PowerShell)
Application `Mail.Read` is tenant-wide by default. Scope it to just this mailbox:

```powershell
Connect-ExchangeOnline -UserPrincipalName admin@northscale.studio

New-DistributionGroup -Name "QuoteAgent-Scope" -Type Security -Members alwyn@northscale.studio

New-ApplicationAccessPolicy -AppId <GRAPH_CLIENT_ID> `
  -PolicyScopeGroupId QuoteAgent-Scope@northscale.studio `
  -AccessRight RestrictAccess -Description "QuoteAgent read-only, single mailbox"

# Verify (allow up to ~30 min to propagate):
Test-ApplicationAccessPolicy -Identity alwyn@northscale.studio -AppId <GRAPH_CLIENT_ID>   # Granted
```

## 3. Outlook folder + rule
1. Create a folder named **Quote requests**.
2. Add a rule: **From `alwyn0678@gmail.com` → move to "Quote requests"**.

## 4. Fill `.env` and verify
```
GRAPH_TENANT_ID=...
GRAPH_CLIENT_ID=...
GRAPH_CLIENT_SECRET=...
GRAPH_MAILBOX_USER=alwyn@northscale.studio
GRAPH_QUOTE_FOLDER=        # get this in the next step
```
- `npm run graph:smoke -- --folders` → copy the **Quote requests** id into `GRAPH_QUOTE_FOLDER`.
- Send a test quote email from `alwyn0678@gmail.com` (it gets filed into the folder).
- `npm run graph:smoke` → it should print that message. ✅ Live read works.
