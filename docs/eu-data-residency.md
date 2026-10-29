# EU data residency on Cloudflare

Verified against Cloudflare docs on 2026-10-29. Every stateful service we plan to
use supports an `eu` jurisdiction. In all cases the jurisdiction restricts where
data is **stored and processed**, not who can call the service: a Worker running
anywhere can still read and write it.

**The jurisdiction can only be set when the resource is created.** A resource
created without it has to be recreated and its data migrated. Set it from the
first local-to-remote setup, and add a check to CI that fails on a missing
jurisdiction.

| Service         | How to set it                                                                             | Notes                                                                                                                                        | Source                                                                                                                                                                                            |
| --------------- | ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1              | `wrangler d1 create <name> --jurisdiction=eu`                                             | Read replicas stay inside the jurisdiction. A location hint is ignored when a jurisdiction is set.                                           | [D1 data location](https://developers.cloudflare.com/d1/configuration/data-location/)                                                                                                             |
| R2              | Pick EU location at bucket creation; set `jurisdiction` on the binding in Wrangler config | S3 API needs the `<account>.eu.r2.cloudflarestorage.com` endpoint. Local uploads not supported. Logpush cannot write to EU buckets directly. | [R2 data location](https://developers.cloudflare.com/r2/reference/data-location/)                                                                                                                 |
| Queues          | `--jurisdiction eu` at queue creation                                                     | Added September 2026.                                                                                                                        | [Queues data location](https://developers.cloudflare.com/queues/configuration/data-location/), [changelog](https://developers.cloudflare.com/changelog/post/2026-09-18-queues-jurisdictions/)     |
| Durable Objects | `env.NS.jurisdiction("eu")` when creating IDs                                             | Object IDs are logged outside the jurisdiction for billing and debugging, so never put personal data in DO names.                            | [DO data location](https://developers.cloudflare.com/durable-objects/reference/data-location/)                                                                                                    |
| Workflows       | `jurisdiction` on the workflow binding                                                    | Added 2026-10-27, needs Wrangler 4.152.0+. Deleting the workflow deletes its instances.                                                      | [Workflows data location](https://developers.cloudflare.com/workflows/reference/data-location/), [changelog](https://developers.cloudflare.com/changelog/post/2026-10-27-workflow-jurisdictions/) |

## Not covered yet

- **Workers compute.** Requests are handled wherever the Worker runs; jurisdiction
  applies to storage. Whether we need the Data Localization Suite (an Enterprise
  product) for processing guarantees is a legal question, not a technical one.
  Most comparable SaaS rely on EU storage plus a DPA.
- **Workers Logs and analytics.** Logs may include personal data. Keep names and
  emails out of log lines by default; log IDs only.
- **Email provider.** Whatever sends email processes addresses. Check its
  location and DPA when we choose one.
- **Backups and exports.** D1 Time Travel stays with the database. Any exports
  we generate go to the EU R2 bucket with a lifecycle rule.
