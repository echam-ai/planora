import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  Archive,
  ArrowLeftRight,
  Bot,
  ChevronDown,
  LayoutGrid,
  Lock,
  Monitor,
  Moon,
  Palette,
  Plus,
  Settings,
  Sun,
  WifiOff,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { BrandMark } from "@/components/brand/BrandMark";
import { ProfileAvatar } from "@/components/brand/ProfileAvatar";
import { setAccessState } from "@/features/auth/access";
import { api } from "@/services/api";
import { THEME_OPTIONS, parseThemePreference, useTheme, type ThemePreference } from "@/lib/theme";
import { ChatPanel } from "@/features/chat/components/ChatPanel";
import { CreateTaskDialog } from "@/features/tasks/components/CreateTaskDialog";
import { selectProfile, useSelectedProfile, PROFILES } from "@/services/api/profiles";
import { APP_NAME } from "@/types";
import { cn } from "@/lib/utils";

const THEME_ICONS: Record<ThemePreference, typeof Sun> = {
  system: Monitor,
  light: Sun,
  dark: Moon,
  colorful: Palette,
};

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
  const { preference, setPreference } = useTheme();
  const themeLabelId = useId();
  const nameId = useId();

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
  const [lockFailed, setLockFailed] = useState(false);
  // Lock ends this browser's access (#124). Only a successful `lock()` leaves the page: if the
  // cookie could not be cleared the user stays, told so, rather than shown a locked-looking page
  // that is still unlocked. Leaving unmounts the board, its task sheet and the chat panel.
  const lock = async () => {
    setLockFailed(false);
    try {
      await api.lock();
    } catch {
      setLockFailed(true);
      return;
    }
    setChatOpen(false);
    setCreateOpen(false);
    qc.clear();
    setAccessState("locked");
    navigate({ to: "/login", replace: true });
  };

  return (
    <div className="flex min-h-screen flex-col">
      {!online && (
        <div className="flex items-center justify-center gap-2 bg-warning/25 px-4 py-2 text-sm font-medium text-warning-foreground">
          <WifiOff className="h-4 w-4" aria-hidden /> You're offline — changes may not be saved.
        </div>
      )}

      <header className="sticky top-0 z-30 border-b border-border bg-header backdrop-blur-xl">
        <div className="mx-auto flex h-16 w-full max-w-7xl items-center gap-1.5 px-3 sm:gap-3 sm:px-4">
          <Link
            to="/tasks"
            aria-label={APP_NAME}
            className="flex min-h-11 min-w-11 shrink-0 items-center justify-center gap-2.5 rounded-xl"
          >
            <BrandMark />
            <span className="hidden text-lg font-semibold tracking-tight lg:inline">
              {APP_NAME}
            </span>
          </Link>

          <nav
            className="ml-2 hidden items-center gap-1 rounded-full bg-muted p-1 md:flex"
            aria-label="Main"
          >
            {navItems.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                className="inline-flex min-h-11 items-center gap-2 rounded-full px-4 text-sm font-medium text-muted-foreground transition-colors duration-150 hover:text-foreground [&.active]:bg-card [&.active]:text-foreground [&.active]:shadow-card"
              >
                <item.icon className="h-4 w-4" aria-hidden />
                {item.label}
              </Link>
            ))}
          </nav>

          <div className="ml-auto flex min-w-0 items-center gap-1.5 sm:gap-2">
            <Button
              ref={addTaskRef}
              onClick={() => setCreateOpen(true)}
              className="w-11 rounded-full bg-brand-gradient px-0 text-brand-foreground shadow-card hover:brightness-110 lg:w-auto lg:px-5"
              aria-label="Add task"
            >
              <Plus className="h-4 w-4" aria-hidden />
              <span className="hidden lg:inline">Add task</span>
            </Button>
            <Button
              variant="secondary"
              className="w-11 rounded-full px-0 shadow-none aria-pressed:bg-accent aria-pressed:text-accent-foreground lg:w-auto lg:px-4"
              onClick={() => setChatOpen((v) => !v)}
              aria-pressed={chatOpen}
              aria-label="AI Assistant"
            >
              <Bot className="h-4 w-4" aria-hidden />
              <span className="hidden lg:inline">AI Assistant</span>
            </Button>
            <Link
              to="/settings"
              aria-label="Settings"
              className="inline-flex size-11 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground [&.active]:bg-muted [&.active]:text-foreground"
            >
              <Settings className="h-5 w-5" aria-hidden />
            </Link>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="flex h-11 min-w-0 cursor-pointer items-center gap-2 rounded-full border border-border bg-card py-0 pl-1 pr-2.5 text-sm font-medium shadow-card transition-colors hover:bg-muted data-[state=open]:bg-muted sm:pr-3"
                  aria-label="Account menu"
                  aria-describedby={nameId}
                >
                  <ProfileAvatar
                    profile={profile === "ech_princess" ? "ech_princess" : "hamster_knight"}
                    className="size-9 rounded-full"
                  />
                  <span
                    aria-label="Selected account"
                    className="min-w-0 truncate text-[13px] sm:text-sm"
                  >
                    <span id={nameId}>{profileName}</span>
                  </span>
                  <ChevronDown
                    className="hidden size-4 shrink-0 text-muted-foreground sm:block"
                    aria-hidden
                  />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-60">
                <DropdownMenuLabel id={themeLabelId}>Theme</DropdownMenuLabel>
                <DropdownMenuRadioGroup
                  aria-labelledby={themeLabelId}
                  value={preference}
                  onValueChange={(value) => setPreference(parseThemePreference(value))}
                >
                  {THEME_OPTIONS.map((option) => {
                    const Icon = THEME_ICONS[option.value];
                    return (
                      <DropdownMenuRadioItem key={option.value} value={option.value}>
                        {option.label}
                        <Icon className="ml-auto size-4 text-muted-foreground" aria-hidden />
                      </DropdownMenuRadioItem>
                    );
                  })}
                </DropdownMenuRadioGroup>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={logout}>
                  <ArrowLeftRight className="h-4 w-4" /> Switch account
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => void lock()}>
                  <Lock className="h-4 w-4" /> Lock
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </header>

      {lockFailed && (
        <div
          role="alert"
          className="sticky top-[65px] z-20 flex items-center justify-center gap-2 border-b border-destructive/30 bg-card px-4 py-2 text-sm font-medium text-destructive"
        >
          <Lock className="h-4 w-4" aria-hidden /> Couldn't lock. Try again.
        </div>
      )}

      <div className="flex flex-1">
        <main className="min-w-0 flex-1 pb-24 md:pb-0">{children}</main>
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
        className="fixed inset-x-0 bottom-0 z-30 flex border-t border-border bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl md:hidden"
        aria-label="Main mobile"
      >
        {[...navItems, { to: "/settings", label: "Settings", icon: Settings }].map((item) => (
          <Link
            key={item.to}
            to={item.to}
            className="group flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 text-xs font-medium text-muted-foreground transition-colors [&.active]:text-foreground"
          >
            <span className="flex h-7 w-14 items-center justify-center rounded-full transition-colors duration-150 group-[.active]:bg-secondary group-[.active]:text-secondary-foreground">
              <item.icon className="h-5 w-5" aria-hidden />
            </span>
            {item.label}
          </Link>
        ))}
      </nav>

      <CreateTaskDialog open={createOpen} onOpenChange={setCreateOpen} returnFocusTo={addTaskRef} />
    </div>
  );
}
