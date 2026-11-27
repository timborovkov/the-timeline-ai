# HubSpot deal pipelines

A workspace admin can import deals and their associated companies from a selected HubSpot pipeline. Later deal stage changes move cards on the destination board. Timeline reads CRM records and never submits changes to HubSpot.

## Configure the app

1. Create an OAuth app in a HubSpot developer account. Request `oauth`, `crm.objects.deals.read` and `crm.objects.companies.read`. Register the HTTPS callback at `/api/integrations/hubspot/callback` on the Timeline origin.
2. Set `HUBSPOT_CLIENT_ID` and `HUBSPOT_CLIENT_SECRET` in the web and worker environments. Use the shared integration encryption key described in [integrations setup](integrations.md#encryption-key-required-first).
3. Point app webhook subscriptions to `/api/webhooks/hubspot` on the same origin. Subscribe to deal creation, deletion, restoration, deal name, pipeline and stage changes, company name changes and deal–company associations. The handler authenticates notifications and schedules a read of the team's selected pipelines. Scheduled reconciliation also discovers changes.
4. Connect the account from **Connections → Sources**, share the pipeline, and activate team capture. Wait for the first capture to populate its stage list.

## Import into a board

Open **Import and keep in sync**, choose a pipeline and destination, and preview the records. Map each stage, preview the resulting changes, and confirm any existing company or deal matches. Unresolved matches stay available when you reopen the preview. Confirm the import to authorize future stage changes. The card shows its source and lets an admin stop syncing the stage. A deal that leaves the pipeline keeps its card and its last lane.

## Verify on HubSpot Free

Use an ordinary free CRM account with a synthetic company and deal. Put a matching company on Timeline, import the deal, then change its stage in HubSpot. Check the company relationship, destination lane and provider link. Repeat the preview and check that it reuses both records. Stop syncing the stage, move the card in Timeline, and verify that further CRM changes leave the card in its local lane. Live acceptance requires the registered app and a reachable HTTPS webhook origin. [HubSpot Free CRM](https://www.hubspot.com/products/crm) · [HubSpot API reference](https://developers.hubspot.com/docs/)
