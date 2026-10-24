import Link from "next/link";
import { notFound } from "next/navigation";
import { getScan } from "@/lib/store";
import ReportView from "@/components/report-view";
import { ArrowLeft, Shield } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function ReportPage(props: {
  params: Promise<{ scanId: string }>;
}) {
  const { scanId } = await props.params;
  const report = await getScan(scanId);

  if (!report) {
    notFound();
  }

  return (
    <div className="min-h-screen bg-vc-background text-vc-text-primary font-sans pb-16">
      <header className="border-b border-vc-border bg-vc-sidebar/95 sticky top-0 z-40 backdrop-blur-md">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <Link
            href="/"
            className="inline-flex items-center gap-2 text-xs font-semibold text-vc-text-secondary hover:text-vc-text-primary transition-colors"
          >
            <ArrowLeft size={15} />
            <span>Back to Console</span>
          </Link>

          <div className="flex items-center gap-2 text-xs text-vc-text-secondary">
            <Shield size={15} className="text-vc-accent" />
            <span>Standalone Report View</span>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-8">
        <ReportView report={report} />
      </main>
    </div>
  );
}
