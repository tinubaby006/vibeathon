// app/api/reports/[scanId]/handoff/route.ts
// Serves Remediation Handoff for a coding agent as JSON or Markdown attachment.

import { NextResponse } from "next/server";
import { ApiResult } from "@/lib/contracts";
import { getScan } from "@/lib/store";
import { buildRemediationHandoff, renderHandoffMarkdown } from "@/lib/handoff";

export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  props: { params: Promise<{ scanId: string }> }
): Promise<Response> {
  const { scanId } = await props.params;
  const report = await getScan(scanId);

  if (!report) {
    const errorBody: ApiResult<never> = {
      ok: false,
      error: {
        code: "REPORT_NOT_FOUND",
        message: `Scan report with ID '${scanId}' was not found.`,
        retryable: false,
      },
    };
    return NextResponse.json(errorBody, { status: 404 });
  }

  const handoff = buildRemediationHandoff(report);
  const markdown = renderHandoffMarkdown(handoff);

  const url = new URL(req.url);
  const format = url.searchParams.get("format")?.toLowerCase();

  const safeAppName = report.applicationSnapshot.displayName
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-");
  const shortId = report.id.substring(0, 8);

  if (format === "markdown") {
    return new Response(markdown, {
      status: 200,
      headers: {
        "Content-Type": "text/markdown; charset=utf-8",
        "Content-Disposition": `attachment; filename="remediation-handoff-${safeAppName}-${shortId}.md"`,
      },
    });
  }

  if (format === "json") {
    const jsonString = JSON.stringify(handoff, null, 2);
    return new Response(jsonString, {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="remediation-handoff-${safeAppName}-${shortId}.json"`,
      },
    });
  }

  return NextResponse.json({
    ok: true,
    data: handoff,
    markdown,
  });
}
