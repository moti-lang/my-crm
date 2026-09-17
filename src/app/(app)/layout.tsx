import { AppNav } from "@/components/shell/nav";
import { Fab } from "@/components/shell/fab";
import { SwRegister } from "@/components/shell/sw-register";
import { SyncManager } from "@/components/shell/sync-manager";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh md:flex">
      <AppNav />
      <main className="flex-1 min-w-0 pb-24 md:pb-8">
        <div className="mx-auto w-full max-w-5xl px-4 pt-3 md:pt-6">
          <SyncManager />
          {children}
        </div>
      </main>
      <Fab />
      <SwRegister />
    </div>
  );
}
