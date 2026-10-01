---
name: reno-research-product
description: Research or revise a named Reno Layouts product request and submit sourced specifications for human review.
---

Use the open Reno Layouts page's WebMCP tools. If unavailable, ask the user to open the site and a project in a supported browser surface.

Find the user's request with `list_product_requests`. Resume an open request; report other states rather than duplicating it. Use `request_product` only for requested research with no matching request. Process the whole queue only when asked.

Read `get_product_brief`. Follow its current protocol, field definitions and reviewer feedback. If the brief lists attachments, use those spec sheets first: read their page text from the brief and cite them as `attachment:<id>` with the page as locator. An image attachment has no text; ask the user to paste it into the conversation if you need it. Otherwise use available browsing or document tools for evidence. If product identity or source access is unresolved, report the blocker.

Submit through `submit_product_spec`. Correct validation failures from evidence, then read back the brief to verify the stored submission. Report that it awaits human review, including unresolved or conflicting fields. Acceptance and placement are separate steps.
