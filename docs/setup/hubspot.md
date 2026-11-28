# HubSpot deal pipelines

A workspace admin can import deals and their associated companies from a selected HubSpot pipeline. Later deal stage changes move cards on the destination board. Timeline reads CRM records and never submits changes to HubSpot.

## Configure the app

The [HubSpot CLI project](../../integrations/hubspot) is the source for the Marketplace app. Edit its [OAuth settings](../../integrations/hubspot/src/app/app-hsmeta.json) and [webhook subscriptions](../../integrations/hubspot/src/app/webhooks/webhooks-hsmeta.json) in this repository. Keep the project name and component UIDs when updating an existing registration.

The project also includes HubSpot’s generated coding-assistant guides and [CLI project overview](../../integrations/hubspot/HUBSPOT_PROJECTS.md). Refresh these files from the scaffold for the platform version in `hsproject.json`. [HubSpot scaffold source](https://github.com/HubSpot/hubspot-project-components/tree/16181f9eb872aba7aedcfbfe27ce9fad178a5d54/2026.09/defaultFiles)

1. From the repository root, run `cd integrations/hubspot`. Authenticate the HubSpot CLI to the developer account that owns the app with `hs account auth`. Keep account credentials in the local CLI configuration.
2. When ready to apply the manifests to HubSpot, run `hs project upload` from that directory. Confirm the intended developer account. After deployment, run `hs project open` and open the app’s **Auth** settings. Marketplace listing submission is a separate step.
3. Set `HUBSPOT_CLIENT_ID` and `HUBSPOT_CLIENT_SECRET` in the Timeline web and worker environments. Use the shared integration encryption key described in [integrations setup](integrations.md#encryption-key-required-first).
4. Connect the account from **Connections → Sources**, share the pipeline, and activate team capture. Wait for the first capture to populate its stage list.

The committed URLs target `https://thetimeline.cc`. For an isolated preview, use a separate HubSpot test project and point both its OAuth redirect and webhook target at the public HTTPS origin running the integration. Webhooks schedule a read of selected pipelines. Scheduled reconciliation also discovers changes.

## Import into a board

Open **Import and keep in sync**, choose a pipeline and destination, and preview the records. Map each stage, preview the resulting changes, and confirm any existing company or deal matches. Unresolved matches stay available when you reopen the preview. If a synced deal gains a company that needs review, its stage keeps updating. Confirm the company match in the preview to add the relationship. Confirm the import to authorize future stage changes. The card shows its source and lets an admin stop syncing the stage. A deal that leaves the pipeline keeps its card and its last lane.

## Verify on HubSpot Free

Use an ordinary free CRM account with a synthetic company and deal. Put a matching company on Timeline, import the deal, then change its stage in HubSpot. Check the company relationship, destination lane and provider link. Repeat the preview and check that it reuses both records. Stop syncing the stage, move the card in Timeline, and verify that further CRM changes leave the card in its local lane. Live acceptance requires the registered app and a reachable HTTPS webhook origin. [HubSpot Free CRM](https://www.hubspot.com/products/crm) · [HubSpot API reference](https://developers.hubspot.com/docs/)
