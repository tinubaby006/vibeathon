import Console from "@/components/console";
import { getApplications, getNotifications } from "@/lib/store";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const [applications, notifications] = await Promise.all([
    getApplications(),
    getNotifications(),
  ]);

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

  return (
    <Console
      initialApplications={applications}
      initialNotifications={notifications}
      integrations={integrations}
    />
  );
}
