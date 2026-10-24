import { NextResponse } from "next/server";
import { ApiResult, ScanReport } from "@/lib/contracts";
import { getApplication } from "@/lib/store";
import { executeScan, ScannerError } from "@/lib/scanner";

export const dynamic = "force-dynamic";

export async function POST(
  _req: Request,
  props: { params: Promise<{ id: string }> }
): Promise<NextResponse<ApiResult<ScanReport>>> {
  try {
    const { id } = await props.params;
    const application = await getApplication(id);

    if (!application) {
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: "APPLICATION_NOT_FOUND",
            message: `Application with ID '${id}' was not found.`,
            retryable: false,
          },
        },
        { status: 404 }
      );
    }

    const report = await executeScan(application);

    return NextResponse.json({
      ok: true,
      data: report,
    });
  } catch (err) {
    if (err instanceof ScannerError) {
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: err.code,
            message: err.message,
            retryable: err.retryable,
          },
        },
        { status: err.statusCode }
      );
    }

    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "SCAN_EXECUTION_ERROR",
          message: (err as Error).message || "An unexpected error occurred during scan execution",
          retryable: false,
        },
      },
      { status: 500 }
    );
  }
}
