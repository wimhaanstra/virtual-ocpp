import type { ReactNode } from "react";
import {
  LayoutDashboard,
  ListChecks,
  LogOut,
  MessagesSquare,
  PanelLeftClose,
  PanelLeftOpen,
  PlugZap,
  Plus,
  SunMoon,
  Tags as TagsIcon,
  type LucideIcon
} from "lucide-react";
import type { ActiveView, ChargerRegistryRow, LiveStatus, ThemeMode } from "../types";
import { getChargerContextId, getChargerDisplayLabel, sortChargers } from "../app-helpers";
import { Button } from "./ui/button";

const chargerScopedNavItems: Array<{ view: ActiveView; label: string; icon: LucideIcon }> = [
  { view: "Home", label: "Dashboard", icon: LayoutDashboard },
  { view: "Sessions", label: "Sessions", icon: ListChecks },
  { view: "Proxy targets", label: "Proxy targets", icon: PlugZap },
  { view: "Tag access", label: "Tag access", icon: TagsIcon }
];

const globalNavItems: Array<{ view: ActiveView; label: string; icon: LucideIcon }> = [
  { view: "Tags", label: "Tags", icon: TagsIcon },
  { view: "Communication", label: "Communication", icon: MessagesSquare }
];

type AppChromeProps = {
  activeView: ActiveView;
  busy: boolean;
  chargers: ChargerRegistryRow[];
  children: ReactNode;
  message: string;
  selectedChargerId: string;
  selectedChargerLabel: string;
  sidebarCollapsed: boolean;
  theme: ThemeMode;
  liveStatus: LiveStatus;
  onLogout: () => void;
  onOpenChargerWizard: () => void;
  onNavigate: (view: ActiveView) => void;
  onSelectedChargerChange: (chargerId: string) => void;
  onSidebarCollapsedChange: (collapsed: boolean) => void;
  onThemeToggle: () => void;
};

export function AppChrome({
  activeView,
  busy,
  chargers,
  children,
  message,
  selectedChargerId,
  selectedChargerLabel,
  sidebarCollapsed,
  theme,
  liveStatus,
  onLogout,
  onOpenChargerWizard,
  onNavigate,
  onSelectedChargerChange,
  onSidebarCollapsedChange,
  onThemeToggle
}: AppChromeProps) {
  return (
    <main className={`app-shell ${sidebarCollapsed ? "app-shell-collapsed" : ""}`}>
      <aside className="sidebar" aria-label="Main navigation">
        <div className="sidebar-top">
          <div className="brand">
            <PlugZap aria-hidden="true" />
            <span className="sidebar-label">Virtual OCPP</span>
          </div>

          <label className="sidebar-context" htmlFor="charger-context-select">
            <span className="sidebar-label">Charger context</span>
            <select
              id="charger-context-select"
              value={selectedChargerId}
              onChange={(event) => onSelectedChargerChange(event.target.value)}
              aria-label="Charger context"
              title={selectedChargerLabel}
            >
              <option value="">All chargers</option>
              {sortChargers(chargers).map((charger) => (
                <option key={charger.id} value={getChargerContextId(charger)}>
                  {getChargerDisplayLabel(charger)}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="sidebar-nav-shell">
          <nav className="sidebar-nav" aria-label="Charger-scoped pages">
            <p className="sidebar-section-label sidebar-label">Charger-scoped</p>
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

          <nav className="sidebar-nav sidebar-nav-global" aria-label="Global and admin pages">
            <p className="sidebar-section-label sidebar-label">Global / admin</p>
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
        </div>

        <footer className="sidebar-footer">
          <div className="sidebar-footer-actions">
            <Button
              type="button"
              className="button-secondary icon-button sidebar-footer-button"
              onClick={onThemeToggle}
              disabled={busy}
              title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
              aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
            >
              <SunMoon aria-hidden="true" />
              <span className="sidebar-label">Theme</span>
            </Button>
            <Button
              type="button"
              className="button-secondary icon-button sidebar-footer-button"
              onClick={onLogout}
              disabled={busy}
              title="Sign out"
              aria-label="Sign out"
            >
              <LogOut aria-hidden="true" />
              <span className="sidebar-label">Sign out</span>
            </Button>
          </div>
          <Button
            type="button"
            className="sidebar-collapse-button"
            onClick={() => onSidebarCollapsedChange(!sidebarCollapsed)}
            aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {sidebarCollapsed ? <PanelLeftOpen aria-hidden="true" /> : <PanelLeftClose aria-hidden="true" />}
            <span className="sidebar-label">{sidebarCollapsed ? "Expand" : "Collapse"}</span>
          </Button>
        </footer>
      </aside>

      <section className="content">
        <header className="topbar">
          <div>
            <p className="eyebrow">Self-hosted CSMS</p>
            <h1>{activeView === "Home" ? "Home dashboard" : activeView}</h1>
          </div>
          <div className="topbar-actions">
            <span className={`live-indicator live-indicator-${liveStatus}`} title="Operator live update channel">
              <span aria-hidden="true" />
              {liveStatus === "live" ? "Live" : liveStatus === "stale" ? "Stale" : "Connecting"}
            </span>
            <Button type="button" className="button-secondary icon-button" onClick={onOpenChargerWizard} disabled={busy} title="Add charger" aria-label="Add charger">
              <Plus aria-hidden="true" />
            </Button>
          </div>
        </header>

        {message ? (
          <p className="notice" role="status">
            {message}
          </p>
        ) : null}

        {children}
      </section>
    </main>
  );
}
