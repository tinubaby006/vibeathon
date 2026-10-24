import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { RegisterApplicationSchema, ApiResult, Application } from "@/lib/contracts";
import { parseGitHubUrl, validateProjectPath } from "@/lib/github";
import { getApplications, addApplication } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse<ApiResult<{
  applications: Application[];
  integrations: {
    githubTokenConfigured: boolean;
    geminiConfigured: boolean;
    emailConfigured: boolean;
  };
}>>> {
  try {
    const applications = await getApplications();
    const integrations = {
      githubTokenConfigured: Boolean(process.env.GITHUB_TOKEN?.trim()),
      geminiConfigured: Boolean(process.env.GEMINI_API_KEY?.trim()),
      emailConfigured: Boolean(
        process.env.ENABLE_EMAIL_NOTIFICATIONS === "true" &&
          process.env.RESEND_API_KEY?.trim() &&
          process.env.RESEND_FROM?.trim() &&
          process.env.DEVELOPER_EMAIL?.trim()
      ),
    };

    return NextResponse.json({
      ok: true,
      data: { applications, integrations },
    });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "STORE_ERROR",
          message: (err as Error).message || "Failed to load applications",
          retryable: true,
        },
      },
      { status: 500 }
    );
  }
}

export async function POST(
  req: Request
): Promise<NextResponse<ApiResult<Application>>> {
  try {
    const body = await req.json();
    const parsed = RegisterApplicationSchema.safeParse(body);
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

    const {
      repoUrl,
      displayName,
      requestedRef,
      projectPath,
      deploymentUrl,
      deploymentClaim,
      declaredDeployedCommit,
    } = parsed.data;

    const { owner, repo, canonicalUrl } = parseGitHubUrl(repoUrl);
    const normalizedPath = validateProjectPath(projectPath);

    const newApp: Application = {
      id: randomUUID(),
      displayName: displayName && displayName.trim() ? displayName.trim() : `${owner}/${repo}`,
      owner,
      repo,
      canonicalRepoUrl: canonicalUrl,
      requestedRef: requestedRef && requestedRef.trim() ? requestedRef.trim() : null,
      projectPath: normalizedPath,
      deploymentUrl: deploymentUrl && deploymentUrl.trim() ? deploymentUrl.trim() : null,
      deploymentClaim,
      declaredDeployedCommit: declaredDeployedCommit && declaredDeployedCommit.trim() ? declaredDeployedCommit.trim() : null,
      createdAt: new Date().toISOString(),
      lastScanId: null,
      lastSuccessfulScanId: null,
    };

    const saved = await addApplication(newApp);

    return NextResponse.json({
      ok: true,
      data: saved,
    });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "REGISTRATION_FAILED",
          message: (err as Error).message || "Failed to register application",
          retryable: false,
        },
      },
      { status: 400 }
    );
  }
}
