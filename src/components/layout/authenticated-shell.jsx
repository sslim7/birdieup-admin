import { SidebarProvider } from '@/components/layout/sidebar-context';
import { Sidebar } from '@/components/layout/sidebar';
import { Header } from '@/components/layout/header';

/** Toaster 는 셸 밖 화면(로그인/비밀번호 변경)에서도 필요해 App 루트에 마운트되어 있다. */
export function AuthenticatedShell({ children }) {
  return (
    <SidebarProvider>
      <div className="flex h-screen overflow-hidden">
        <Sidebar />
        <div className="flex-1 flex flex-col overflow-hidden">
          <Header />
          <main className="flex-1 flex flex-col overflow-y-auto p-8">
            <div className="max-w-screen-2xl mx-auto w-full">{children}</div>
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
