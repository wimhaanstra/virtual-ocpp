import { useEffect, useState, type ReactNode } from "react";
import {
  BatteryCharging,
  LayoutDashboard,
  ListChecks,
  LogOut,
  MessagesSquare,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  PlugZap,
  Settings2,
  SunMoon,
  Tags as TagsIcon,
  type LucideIcon,
  Wrench
} from "lucide-react";
import type { ActiveView, LiveStatus, ThemeMode } from "../types";
import { Button } from "./ui/button";

const chargerScopedNavItems: Array<{ view: ActiveView; label: string; icon: LucideIcon }> = [
  { view: "Charger dashboard", label: "Dashboard", icon: LayoutDashboard },
  { view: "Sessions", label: "Sessions", icon: ListChecks },
  { view: "Proxy targets", label: "Proxy targets", icon: PlugZap },
  { view: "Tag access", label: "Tag access", icon: TagsIcon },
  { view: "Diagnostics", label: "Diagnostics", icon: Wrench }
];

const globalNavItems: Array<{ view: ActiveView; label: string; icon: LucideIcon }> = [
  { view: "Home", label: "Overview", icon: LayoutDashboard },
  { view: "Settings", label: "Settings", icon: Settings2 },
  { view: "Chargers", label: "Chargers", icon: BatteryCharging },
  { view: "Tags", label: "Tags", icon: TagsIcon },
  { view: "Communication", label: "Communication", icon: MessagesSquare }
];

const mobilePrimaryNavItems: Array<{ view: ActiveView; label: string; icon: LucideIcon }> = [
  { view: "Charger dashboard", label: "Dashboard", icon: LayoutDashboard },
  { view: "Sessions", label: "Sessions", icon: ListChecks },
  { view: "Proxy targets", label: "Targets", icon: PlugZap }
];

const mobileMoreNavItems: Array<{ view: ActiveView; label: string; icon: LucideIcon }> = [
  { view: "Tag access", label: "Tag access", icon: TagsIcon },
  { view: "Diagnostics", label: "Diagnostics", icon: Wrench },
  ...globalNavItems
];

type AppChromeProps = {
  activeView: ActiveView;
  appVersion: string | null;
  busy: boolean;
  children: ReactNode;
  message: string;
  sidebarCollapsed: boolean;
  theme: ThemeMode;
  liveStatus: LiveStatus;
  onLogout: () => void;
  onNavigate: (view: ActiveView) => void;
  onSidebarCollapsedChange: (collapsed: boolean) => void;
  onThemeToggle: () => void;
};

export function AppChrome({
  activeView,
  appVersion,
  busy,
  children,
  message,
  sidebarCollapsed,
  theme,
  liveStatus,
  onLogout,
  onNavigate,
  onSidebarCollapsedChange,
  onThemeToggle
}: AppChromeProps) {
  const [mobileMoreOpen, setMobileMoreOpen] = useState(false);
  const mobileMoreActive = mobileMoreNavItems.some((item) => item.view === activeView);

  useEffect(() => {
    setMobileMoreOpen(false);
  }, [activeView]);

  const navigateFromMobile = (view: ActiveView) => {
    setMobileMoreOpen(false);
    onNavigate(view);
  };

  return (
    <main className={`app-shell ${sidebarCollapsed ? "app-shell-collapsed" : ""}`}>
      <aside className="sidebar" aria-label="Main navigation">
        <div className="sidebar-top">
          <div className="brand">
            <div className="brand-title">
              <span className="brand-window-dots" aria-hidden="true">
                <span />
                <span />
                <span />
              </span>
              <span className="brand-mark">
                <PlugZap aria-hidden="true" />
              </span>
              <span className="sidebar-label">Virtual OCPP</span>
            </div>
            <Button
              type="button"
              className="sidebar-collapse-button"
              onClick={() => onSidebarCollapsedChange(!sidebarCollapsed)}
              aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
              title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            >
              {sidebarCollapsed ? <PanelLeftOpen aria-hidden="true" /> : <PanelLeftClose aria-hidden="true" />}
            </Button>
          </div>
        </div>
        <div className="sidebar-nav-shell">
          <nav className="sidebar-nav" aria-label="Charger-scoped pages">
            {chargerScopedNavItems.map((item) => {
              const Icon = item.icon;
              const isActive = item.view === activeView;

              return (
                <button
                  type="button"
                  className={isActive ? "active" : undefined}
                  aria-current={isActive ? "page" : undefined}
                  aria-label={sidebarCollapsed ? item.label : undefined}
                  title={item.label}
                  onClick={() => onNavigate(item.view)}
                  key={item.view}
                >
                  <span className="sidebar-nav-indicator" aria-hidden="true" />
                  <Icon aria-hidden="true" />
                  <span className="sidebar-label">{item.label}</span>
                </button>
              );
            })}
          </nav>
        </div>

        <footer className="sidebar-footer">
          <div className="sidebar-global-separator" aria-hidden="true" />
          <nav className="sidebar-nav sidebar-nav-global" aria-label="Global and admin pages">
            {globalNavItems.map((item) => {
              const Icon = item.icon;
              const isActive = item.view === activeView;

              return (
                <button
                  type="button"
                  className={isActive ? "active" : undefined}
                  aria-current={isActive ? "page" : undefined}
                  aria-label={sidebarCollapsed ? item.label : undefined}
                  title={item.label}
                  onClick={() => onNavigate(item.view)}
                  key={item.view}
                >
                  <span className="sidebar-nav-indicator" aria-hidden="true" />
                  <Icon aria-hidden="true" />
                  <span className="sidebar-label">{item.label}</span>
                </button>
              );
            })}
          </nav>
          <div className="sidebar-footer-actions">
            <Button
              type="button"
              className="button-ghost icon-button sidebar-footer-button"
              onClick={onThemeToggle}
              disabled={busy}
              title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
              aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
            >
              <SunMoon aria-hidden="true" />
            </Button>
            <Button
              type="button"
              className="button-ghost icon-button sidebar-footer-button"
              onClick={onLogout}
              disabled={busy}
              title="Sign out"
              aria-label="Sign out"
            >
              <LogOut aria-hidden="true" />
            </Button>
          </div>
          <p className="app-version" title={appVersion ? `Virtual OCPP ${appVersion}` : "Version unavailable"}>
            <span className="sidebar-label">Version </span>
            <span>{appVersion ?? "unknown"}</span>
          </p>
        </footer>
      </aside>

      <section className="content">
        <header className="topbar">
          <div>
            <p className="eyebrow">Self-hosted CSMS</p>
            <h1>{activeView === "Home" ? "Global dashboard" : activeView}</h1>
          </div>
          <div className="topbar-actions">
            <span className={`live-indicator live-indicator-${liveStatus}`} title="Operator live update channel">
              {liveStatus === "live" ? "Live" : liveStatus === "stale" ? "Stale" : "Connecting"}
            </span>
          </div>
        </header>

        {message ? (
          <p className="notice" role="status">
            {message}
          </p>
        ) : null}

        {children}
      </section>

      <nav className="mobile-bottom-nav" aria-label="Mobile navigation">
        {mobilePrimaryNavItems.map((item) => {
          const Icon = item.icon;
          const isActive = item.view === activeView;

          return (
            <button
              type="button"
              className={`mobile-bottom-nav__item ${isActive ? "active" : ""}`}
              aria-current={isActive ? "page" : undefined}
              onClick={() => navigateFromMobile(item.view)}
              key={item.view}
            >
              <Icon aria-hidden="true" />
              <span>{item.label}</span>
            </button>
          );
        })}
        <button
          type="button"
          className={`mobile-bottom-nav__item ${mobileMoreActive || mobileMoreOpen ? "active" : ""}`}
          aria-current={mobileMoreActive ? "page" : undefined}
          aria-expanded={mobileMoreOpen}
          aria-controls="mobile-more-menu"
          onClick={() => setMobileMoreOpen((open) => !open)}
        >
          <MoreHorizontal aria-hidden="true" />
          <span>More</span>
        </button>
      </nav>

      {mobileMoreOpen ? (
        <div className="mobile-more-layer">
          <button
            type="button"
            className="mobile-more-backdrop"
            onClick={() => setMobileMoreOpen(false)}
            aria-label="Close more navigation"
          />
          <section className="mobile-more-menu" id="mobile-more-menu" aria-label="More navigation">
            <div className="mobile-more-menu__grid">
              {mobileMoreNavItems.map((item) => {
                const Icon = item.icon;
                const isActive = item.view === activeView;

                return (
                  <button
                    type="button"
                    className={`mobile-more-menu__item ${isActive ? "active" : ""}`}
                    aria-current={isActive ? "page" : undefined}
                    onClick={() => navigateFromMobile(item.view)}
                    key={item.view}
                  >
                    <Icon aria-hidden="true" />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </div>
            <div className="mobile-more-menu__actions">
              <Button
                type="button"
                className="button-secondary mobile-more-action"
                onClick={() => {
                  setMobileMoreOpen(false);
                  onThemeToggle();
                }}
                disabled={busy}
              >
                <SunMoon aria-hidden="true" />
                Theme
              </Button>
              <Button
                type="button"
                className="button-secondary mobile-more-action"
                onClick={() => {
                  setMobileMoreOpen(false);
                  onLogout();
                }}
                disabled={busy}
              >
                <LogOut aria-hidden="true" />
                Sign out
              </Button>
            </div>
          </section>
        </div>
      ) : null}
    </main>
  );
}
