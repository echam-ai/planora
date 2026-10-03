import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { Archive, LayoutGrid, LogOut, Plus, Settings, Sparkles, WifiOff } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ChatPanel } from "@/features/chat/components/ChatPanel";
import { CreateTaskDialog } from "@/features/tasks/components/CreateTaskDialog";
import { selectProfile, useSelectedProfile, PROFILES } from "@/services/api/profiles";
import { APP_NAME } from "@/types";
import { cn } from "@/lib/utils";

const navItems = [
  { to: "/tasks", label: "Active Tasks", icon: LayoutGrid },
  { to: "/archive", label: "Archive", icon: Archive },
] as const;

// Tailwind `lg` — the breakpoint the aside/Sheet split below already uses.
const DESKTOP_CHAT_BREAKPOINT = 1024;

/**
 * Whether the viewport is wide enough for the docked side panel.
 *
 * The mobile/tablet drawer must not mount its Radix dialog at this width: the
 * dialog's overlay and focus-hiding side effects apply to the whole page
 * regardless of which of the drawer's own elements are visually hidden by
 * CSS, so the only way to keep them off the desktop layout is to not mount
 * the Sheet there at all (see AppShell below).
 */
function useIsDesktopChat() {
  const [isDesktop, setIsDesktop] = useState(
    () => typeof window !== "undefined" && window.innerWidth >= DESKTOP_CHAT_BREAKPOINT,
  );

  useEffect(() => {
    const onResize = () => setIsDesktop(window.innerWidth >= DESKTOP_CHAT_BREAKPOINT);
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  return isDesktop;
}

export function AppShell({ children }: { children: ReactNode }) {
  const [chatOpen, setChatOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const addTaskRef = useRef<HTMLButtonElement>(null);
  const [online, setOnline] = useState(true);
  const isDesktopChat = useIsDesktopChat();
  const navigate = useNavigate();
  const qc = useQueryClient();

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  const profile = useSelectedProfile();
  const profileName = PROFILES.find((p) => p.id === profile)?.name;
  const logout = () => {
    selectProfile(null);
    qc.clear();
    navigate({ to: "/" });
  };

  return (
    <div className="flex min-h-screen flex-col bg-background">
      {!online && (
        <div className="flex items-center justify-center gap-2 bg-warning/30 px-4 py-2 text-sm text-warning-foreground">
          <WifiOff className="h-4 w-4" aria-hidden /> You're offline — changes may not be saved.
        </div>
      )}

      <header className="sticky top-0 z-30 border-b border-border bg-background/90 backdrop-blur">
        <div className="mx-auto flex w-full max-w-7xl items-center gap-3 px-4 py-3 max-[360px]:gap-1">
          <Link to="/tasks" className="flex min-h-11 shrink-0 items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-gradient text-primary-foreground">
              <Sparkles className="h-4 w-4" aria-hidden />
            </span>
            <span className="text-lg font-semibold tracking-tight">{APP_NAME}</span>
          </Link>

          <nav className="ml-4 hidden items-center gap-1 md:flex" aria-label="Main">
            {navItems.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                className="inline-flex min-h-11 items-center gap-2 rounded-lg px-3 text-sm font-medium text-muted-foreground hover:bg-secondary hover:text-foreground [&.active]:bg-secondary [&.active]:text-secondary-foreground"
              >
                <item.icon className="h-4 w-4" aria-hidden />
                {item.label}
              </Link>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-2 max-[360px]:gap-0">
            <Button
              ref={addTaskRef}
              onClick={() => setCreateOpen(true)}
              className="min-h-11 max-[360px]:w-11 max-[360px]:px-0"
              aria-label="Add task"
            >
              <Plus className="h-4 w-4" aria-hidden />
              <span className="hidden sm:inline">Add task</span>
            </Button>
            <Button
              variant="outline"
              className="min-h-11 max-[360px]:w-11 max-[360px]:px-0"
              onClick={() => setChatOpen((v) => !v)}
              aria-pressed={chatOpen}
              aria-label="AI Assistant"
            >
              <Sparkles className="h-4 w-4" aria-hidden />
              <span className="hidden sm:inline">AI Assistant</span>
            </Button>
            <Link
              to="/settings"
              aria-label="Settings"
              className="inline-flex h-11 w-11 items-center justify-center rounded-lg text-muted-foreground hover:bg-secondary hover:text-foreground"
            >
              <Settings className="h-5 w-5" aria-hidden />
            </Link>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-secondary text-sm font-semibold text-secondary-foreground"
                  aria-label="Account menu"
                >
                  {profile === "ech_princess" ? "EP" : "HK"}
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={logout}>
                  <LogOut className="h-4 w-4" /> Switch account
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </header>

      <p className="px-4 py-2 text-sm font-medium" aria-label="Selected account">
        {profileName}
      </p>
      <div className="flex flex-1">
        <main className="min-w-0 flex-1 pb-20 md:pb-0">{children}</main>
        <aside
          className={cn(
            "hidden border-l border-border lg:block",
            chatOpen ? "w-[380px] shrink-0" : "w-0 overflow-hidden",
          )}
          aria-hidden={!chatOpen}
        >
          {chatOpen && isDesktopChat && (
            <div className="sticky top-[65px] h-[calc(100vh-65px)]">
              <ChatPanel onClose={() => setChatOpen(false)} />
            </div>
          )}
        </aside>
      </div>

      {/* Mobile / tablet assistant drawer — mounted only below the desktop
          breakpoint, so its Radix dialog (overlay, aria-hidden-the-rest-of-
          the-page) never exists at desktop widths. */}
      {!isDesktopChat && (
        <Sheet open={chatOpen} onOpenChange={setChatOpen}>
          <SheetContent
            side="right"
            // `w-[85%]`, not `w-full`: below the `sm` breakpoint this always
            // leaves a strip of the overlay exposed so a real outside click
            // has somewhere to land (criterion 6) while staying usable for
            // chat even at 360px (~306px of panel width).
            className="w-[85%] p-0 sm:max-w-md"
            // ChatPanel's own "Close assistant" is the drawer's single close
            // control (#81); the built-in 16px "Close" would be a duplicate.
            showCloseButton={false}
            onCloseAutoFocus={(event) => {
              // Radix only restores focus to a SheetTrigger; the header AI
              // Assistant button toggles `chatOpen` directly instead (#57
              // owns that button, so it is not wrapped in one here).
              event.preventDefault();
              document.querySelector<HTMLButtonElement>("header button[aria-pressed]")?.focus();
            }}
          >
            <SheetTitle className="sr-only">AI Assistant</SheetTitle>
            <ChatPanel onClose={() => setChatOpen(false)} />
          </SheetContent>
        </Sheet>
      )}

      <nav
        className="fixed inset-x-0 bottom-0 z-30 flex border-t border-border bg-background md:hidden"
        aria-label="Main mobile"
      >
        {navItems.map((item) => (
          <Link
            key={item.to}
            to={item.to}
            className="flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 text-xs text-muted-foreground [&.active]:text-primary"
          >
            <item.icon className="h-5 w-5" aria-hidden />
            {item.label}
          </Link>
        ))}
        <Link
          to="/settings"
          className="flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 text-xs text-muted-foreground [&.active]:text-primary"
        >
          <Settings className="h-5 w-5" aria-hidden />
          Settings
        </Link>
      </nav>

      <CreateTaskDialog open={createOpen} onOpenChange={setCreateOpen} returnFocusTo={addTaskRef} />
    </div>
  );
}
