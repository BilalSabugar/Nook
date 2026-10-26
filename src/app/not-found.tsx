import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';

export default function NotFound() {
  return (
    <div className="min-h-screen bg-[#0d0d0d] text-neutral-200 flex items-center justify-center p-6">
      <div className="w-full max-w-md rounded-2xl bg-[#141414] border border-white/[0.1] p-8 shadow-2xl text-center space-y-5">
        <div className="w-12 h-12 rounded-full bg-white text-black font-bold text-xl flex items-center justify-center mx-auto shadow-md">
          ●
        </div>

        <div className="space-y-1.5">
          <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-white/[0.06] text-neutral-400 border border-white/[0.08]">
            404 NOT FOUND
          </span>
          <h2 className="text-xl font-semibold text-white tracking-tight mt-2">Space Document Not Found</h2>
          <p className="text-xs text-neutral-400 leading-relaxed">
            The page or space you requested does not exist or has been moved to another location in Nook.
          </p>
        </div>

        <div className="pt-2">
          <Link
            href="/"
            className="inline-flex items-center justify-center gap-2 px-5 py-2 rounded-xl bg-white hover:bg-neutral-200 text-black text-xs font-semibold shadow-sm transition-all active:scale-95"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Return to Workspace</span>
          </Link>
        </div>
      </div>
    </div>
  );
}
