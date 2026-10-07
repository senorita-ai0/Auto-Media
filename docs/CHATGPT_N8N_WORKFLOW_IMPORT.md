
# Auto-Media — ChatGPT + n8n Workflow Authoring

## Purpose

Advanced users can ask ChatGPT to create n8n JSON and import it into Auto-Media.

This accelerates custom automation but does not replace built-in reusable content types.

## Import flow

Automation -> Import n8n Workflow -> paste/upload JSON -> validate -> review requirements -> map credentials -> test -> save version -> activate.

## Validation report

Show:
- workflow name
- node count
- trigger
- AI nodes
- HTTP nodes
- credential requirements
- unsupported nodes
- embedded secrets
- environment variables
- expected inputs
- expected outputs

## Runtime contract

Imported workflows should accept:

~~~json
{
  "jobId": "...",
  "profileId": "...",
  "contentTypeId": "...",
  "automationId": "..."
}
~~~

and return a normalized result.

## Secret scanning

Detect likely API keys, bearer tokens, OAuth tokens, private keys and passwords. Replace secrets with n8n credential references.

## Versioning

Allow import, export, duplicate, test, activate and deactivate while preserving previous versions.

## Built-in versus custom

Use built-in content types for common use cases. Use imported n8n workflows for advanced custom requirements. Both use the same profiles, jobs, media library, destinations and logs.


## Current Auto-Media flow

1. Open **n8n Workflows** in Auto-Media.
2. Paste the JSON exported by ChatGPT.
3. Select **Validate & import**. The backend rejects malformed workflows and likely embedded secrets.
4. Review triggers, AI/HTTP nodes, credential requirements, webhook paths and warnings.
5. Activate the workflow after the matching webhook workflow exists in n8n.
6. In **Content Types**, choose **Custom workflow / n8n** and bind the active workflow.
7. Attach that content type to an Automation and choose its destinations.
8. Run manually or let the native scheduler invoke it.
9. n8n returns the normalized result through the Auto-Media callback; Auto-Media stores content, media and publishing results.

The importer stores the workflow JSON in PostgreSQL and never returns credential secret values from the account APIs. An imported workflow is not automatically installed into n8n; the n8n instance remains the execution host.


### Generate the workflow request from Auto-Media

The n8n Workflows page can now build the ChatGPT request automatically. Select the target Profile and Content Type and choose **Copy ChatGPT request**. The generated request includes the profile's master prompt, tone/audience/language, content recipe configuration, output schema and the Auto-Media webhook/callback contract. Paste that request into ChatGPT and ask it to return only the complete n8n workflow JSON, then use **Validate & import** in Auto-Media.