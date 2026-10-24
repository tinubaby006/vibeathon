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
    <div className="min-h-screen bg-gray-950 text-gray-100 font-sans pb-16">
      <header className="border-b border-gray-800 bg-gray-950/90 sticky top-0 z-40 backdrop-blur-md">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <Link
            href="/"
            className="inline-flex items-center gap-2 text-xs font-semibold text-gray-300 hover:text-white transition-colors"
          >
            <ArrowLeft size={15} />
            <span>Back to Console</span>
          </Link>

          <div className="flex items-center gap-2 text-xs text-gray-400">
            <Shield size={15} className="text-blue-400" />
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
