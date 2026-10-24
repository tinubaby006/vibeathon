import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import {
  ApiResult,
  CommunityAssessment,
  CommunityReportInputSchema,
  Notification,
} from "@/lib/contracts";
import {
  getApplication,
  getCommunityAssessments,
  getScan,
  saveCommunityAssessment,
} from "@/lib/store";
import { analyzeCommunitySignal } from "@/lib/ai";

export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<NextResponse<ApiResult<CommunityAssessment[]>>> {
  try {
    const url = new URL(req.url);
    const applicationId = url.searchParams.get("applicationId");

    if (!applicationId) {
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: "VALIDATION_FAILED",
            message: "Query parameter 'applicationId' is required",
            retryable: false,
          },
        },
        { status: 400 }
      );
    }

    const assessments = await getCommunityAssessments(applicationId);
    return NextResponse.json({
      ok: true,
      data: assessments,
    });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "STORE_ERROR",
          message: (err as Error).message || "Failed to load community signals",
          retryable: true,
        },
      },
      { status: 500 }
    );
  }
}

export async function POST(req: Request): Promise<NextResponse<ApiResult<CommunityAssessment>>> {
  try {
    const body = await req.json();
    const parsed = CommunityReportInputSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: "VALIDATION_FAILED",
            message: parsed.error.issues.map((i) => i.message).join(", "),
            retryable: false,
          },
        },
        { status: 400 }
      );
    }

    const { applicationId, pastedText, sourceUrl } = parsed.data;
    const application = await getApplication(applicationId);

    if (!application) {
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: "APPLICATION_NOT_FOUND",
            message: `Application with ID '${applicationId}' was not found`,
            retryable: false,
          },
        },
        { status: 404 }
      );
    }

    // Require an existing scan report for inventory context
    let inventory: import("@/lib/contracts").DependencyEntry[] = [];
    let existingFindings: import("@/lib/contracts").Finding[] = [];
    let basedOnScanId: string | undefined = undefined;

    if (application.lastScanId) {
      const lastScan = await getScan(application.lastScanId);
      if (lastScan && lastScan.inventory.length > 0) {
        inventory = lastScan.inventory;
        existingFindings = lastScan.findings;
        basedOnScanId = lastScan.id;
      }
    }

    if (inventory.length === 0) {
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: "INVENTORY_REQUIRED",
            message: "A completed dependency scan is required before community signals can be evaluated against installed dependencies.",
            retryable: false,
          },
        },
        { status: 400 }
      );
    }

    // Analyze using Gemini with strict grounding checks
    const analysis = await analyzeCommunitySignal(
      pastedText,
      sourceUrl || undefined,
      inventory,
      existingFindings
    );

    const assessmentId = randomUUID();
    const assessment: CommunityAssessment = {
      id: assessmentId,
      applicationId,
      createdAt: new Date().toISOString(),
      basedOnScanId,
      ...analysis,
    };

    const notification: Notification = {
      id: randomUUID(),
      applicationId,
      communityReportId: assessmentId,
      kind: "community_signal",
      title: `Community Signal: ${application.displayName}`,
      summary: assessment.possibleMatch
        ? `Potential match identified for ${assessment.claimedPackage || "reported package"} in installed inventory (Unverified claim).`
        : `Unverified community signal analyzed: ${assessment.explanation.substring(0, 100)}`,
      createdAt: new Date().toISOString(),
      readAt: null,
    };

    const saved = await saveCommunityAssessment(assessment, notification);

    return NextResponse.json({
      ok: true,
      data: saved,
    });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "SIGNAL_ANALYSIS_FAILED",
          message: (err as Error).message || "Failed to analyze community signal",
          retryable: false,
        },
      },
      { status: 500 }
    );
  }
}
