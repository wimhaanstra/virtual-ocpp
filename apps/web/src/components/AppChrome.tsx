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

const navItems: Array<{ view: ActiveView; label: string; icon: LucideIcon }> = [
  { view: "Home", label: "Dashboard", icon: LayoutDashboard },
  { view: "Communication", label: "Communication", icon: MessagesSquare },
  { view: "Sessions", label: "Sessions", icon: ListChecks },
  { view: "Proxy targets", label: "Proxy targets", icon: PlugZap },
  { view: "Tags", label: "Tags", icon: TagsIcon }
];

type AppChromeProps = {
  activeView: ActiveView;
  busy: boolean;
  chargers: ChargerRegistryRow[];
  children: ReactNode;
  message: string;
  selectedChargerId: string;
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
        <div className="brand">
          <PlugZap aria-hidden="true" />
          <span className="sidebar-label">Virtual OCPP</span>
        </div>
        <nav>
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <button
                type="button"
                className={item.view === activeView ? "active" : undefined}
                aria-current={item.view === activeView ? "page" : undefined}
                aria-label={sidebarCollapsed ? item.label : undefined}
                title={sidebarCollapsed ? item.label : undefined}
                onClick={() => onNavigate(item.view)}
                key={item.view}
              >
                <Icon aria-hidden="true" />
                <span className="sidebar-label">{item.label}</span>
              </button>
            );
          })}
        </nav>
        <button
          type="button"
          className="sidebar-collapse-button"
          onClick={() => onSidebarCollapsedChange(!sidebarCollapsed)}
          aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {sidebarCollapsed ? <PanelLeftOpen aria-hidden="true" /> : <PanelLeftClose aria-hidden="true" />}
          <span className="sidebar-label">{sidebarCollapsed ? "Expand" : "Collapse"}</span>
        </button>
      </aside>

      <section className="content">
        <header className="topbar">
          <div>
            <p className="eyebrow">Self-hosted CSMS</p>
            <h1>{activeView === "Home" ? "Home dashboard" : activeView}</h1>
          </div>
          <div className="topbar-actions topbar-controls">
            <span className={`live-indicator live-indicator-${liveStatus}`} title="Operator live update channel">
              <span aria-hidden="true" />
              {liveStatus === "live" ? "Live" : liveStatus === "stale" ? "Stale" : "Connecting"}
            </span>
            <label className="field topbar-field">
              <span>Charger context</span>
              <select value={selectedChargerId} onChange={(event) => onSelectedChargerChange(event.target.value)}>
                <option value="">All chargers</option>
                {sortChargers(chargers).map((charger) => (
                  <option key={charger.id} value={getChargerContextId(charger)}>
                    {getChargerDisplayLabel(charger)}
                  </option>
                ))}
              </select>
            </label>
            <Button type="button" className="button-secondary icon-button" onClick={onOpenChargerWizard} disabled={busy} title="Add charger" aria-label="Add charger">
              <Plus aria-hidden="true" />
            </Button>
            <Button
              type="button"
              className="button-secondary icon-button"
              onClick={onThemeToggle}
              disabled={busy}
              title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
              aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
            >
              <SunMoon aria-hidden="true" />
            </Button>
            <Button type="button" className="button-secondary" onClick={onLogout} disabled={busy}>
              <LogOut aria-hidden="true" />
              <span className="button-label">Sign out</span>
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
