// app/api/protection/proposals/route.ts
import { NextRequest, NextResponse } from "next/server";
import {
  validateScanTargetBinding,
  generateProposalExplanation,
  createProposalOnController,
} from "@/lib/protection";
import { DEMO_SCENARIO_ID } from "@/services/protection/scenario";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      applicationId?: string;
      scanId?: string;
    };

    if (!body.applicationId) {
      return NextResponse.json(
        { error: "MISSING_APPLICATION_ID", message: "applicationId is required" },
        { status: 400 }
      );
    }

    const bindingCheck = await validateScanTargetBinding(
      body.applicationId,
      body.scanId
    );

    if (!bindingCheck.eligible || !bindingCheck.binding) {
      return NextResponse.json(
        {
          error: "INELIGIBLE_FOR_PROTECTION",
          message: bindingCheck.reason || "Application is not eligible for protection.",
        },
        { status: 400 }
      );
    }

    const rule = { kind: "disable_route" as const, path: "/preview" as const };

    const explanationResult = await generateProposalExplanation({
      binding: bindingCheck.binding,
      finding: bindingCheck.finding,
      rule,
    });

    const proposal = await createProposalOnController({
      scenarioId: DEMO_SCENARIO_ID,
      binding: bindingCheck.binding,
      rule,
      explanation: explanationResult.explanation,
      functionalityCost: explanationResult.functionalityCost,
      limitations: explanationResult.limitations,
      aiStatus: explanationResult.aiStatus,
    });

    return NextResponse.json(proposal, { status: 201 });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: "PROPOSAL_CREATION_FAILED", message: msg },
      { status: 500 }
    );
  }
}
