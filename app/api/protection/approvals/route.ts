// app/api/protection/approvals/route.ts
import { NextRequest, NextResponse } from "next/server";
import { grantApprovalOnController } from "@/lib/protection";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      proposalHash?: string;
      testRunId?: string;
      acknowledgedFunctionalityLoss?: boolean;
      operatorNote?: string;
    };

    if (!body.proposalHash || !body.testRunId) {
      return NextResponse.json(
        {
          error: "MISSING_REQUIRED_FIELDS",
          message: "proposalHash and testRunId are required",
        },
        { status: 400 }
      );
    }

    if (!body.acknowledgedFunctionalityLoss) {
      return NextResponse.json(
        {
          error: "ACKNOWLEDGEMENT_REQUIRED",
          message:
            "Developer must explicitly acknowledge preview functionality loss before approval can be granted.",
        },
        { status: 400 }
      );
    }

    const approval = await grantApprovalOnController({
      proposalHash: body.proposalHash,
      testRunId: body.testRunId,
      acknowledgedFunctionalityLoss: true,
      operatorNote: body.operatorNote,
    });

    return NextResponse.json(approval, { status: 201 });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: "APPROVAL_FAILED", message: msg },
      { status: 400 }
    );
  }
}
