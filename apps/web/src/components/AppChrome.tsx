import type { ReactNode } from "react";
import {
  BatteryCharging,
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
  { view: "Charger dashboard", label: "Dashboard", icon: LayoutDashboard },
  { view: "Sessions", label: "Sessions", icon: ListChecks },
  { view: "Proxy targets", label: "Proxy targets", icon: PlugZap },
  { view: "Tag access", label: "Tag access", icon: TagsIcon }
];

const globalNavItems: Array<{ view: ActiveView; label: string; icon: LucideIcon }> = [
  { view: "Home", label: "Overview", icon: LayoutDashboard },
  { view: "Chargers", label: "Chargers", icon: BatteryCharging },
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
            <div className="brand-title">
              <PlugZap aria-hidden="true" />
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

          <label className="sidebar-context" htmlFor="charger-context-select">
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
              className="button-secondary sidebar-footer-button"
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
              className="button-secondary sidebar-footer-button"
              onClick={onLogout}
              disabled={busy}
              title="Sign out"
              aria-label="Sign out"
            >
              <LogOut aria-hidden="true" />
              <span className="sidebar-label">Sign out</span>
            </Button>
          </div>
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
