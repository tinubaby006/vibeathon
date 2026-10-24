// app/api/protection/demo/init/route.ts
// Initializes or retrieves the Checkpoint 2 Local Protection Demo application context.
// Does NOT modify or overwrite existing repository scans.

import { NextResponse } from "next/server";
import { getOrInitLocalDemo, scanLocalDemo } from "@/lib/local-demo";
import { ApiResult, Application, ScanReport } from "@/lib/contracts";

export const dynamic = "force-dynamic";

export async function POST(
  req: Request
): Promise<NextResponse<ApiResult<{ application: Application; scan: ScanReport | null }>>> {
  try {
    let autoScan = false;
    try {
      const body = await req.json();
      autoScan = Boolean(body?.autoScan);
    } catch {
      // Body may be empty
    }

    const { application, scan } = await getOrInitLocalDemo();

    if (autoScan || !scan) {
      const scanned = await scanLocalDemo();
      return NextResponse.json({
        ok: true,
        data: {
          application: scanned.application,
          scan: scanned.scan,
        },
      });
    }

    return NextResponse.json({
      ok: true,
      data: {
        application,
        scan,
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "DEMO_INIT_FAILED",
          message,
          retryable: false,
        },
      },
      { status: 500 }
    );
  }
}
