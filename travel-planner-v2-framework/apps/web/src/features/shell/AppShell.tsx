import { useState } from 'react';
import type { PublicUser } from '@travel/shared';
import type { ApiClient } from '../../lib/api-client';
import type { TripEntry } from '../trip-create/host-integration';
import FootprintPage from '../footprints/FootprintPage';
import HomePage from '../home/HomePage';
import ProfilePage from '../profile/ProfilePage';
import TripWorkspace from '../trip-create/TripWorkspace';
import './shell.css';

export type ShellTab = 'home' | 'trips' | 'footprints' | 'profile';

/** 与 V1 的四页保持一致：旅行助手 / 行程 / 足迹 / 我的。 */
export const SHELL_TABS: readonly { id: ShellTab; icon: string; label: string }[] = [
  { id: 'home', icon: '🧭', label: '旅行助手' },
  { id: 'trips', icon: '✈️', label: '行程' },
  { id: 'footprints', icon: '👣', label: '足迹' },
  { id: 'profile', icon: '👤', label: '我的' },
];

export interface AppShellProps {
  user: PublicUser;
  getAccessToken: () => string | null | Promise<string | null>;
  /** 全站统一客户端，交给各页面复用。 */
  client: ApiClient;
  /** 行程视图的深链接入口（`/trips/new`、`/trips/:id/edit`），由宿主解析 URL 后传入。 */
  entry?: TripEntry;
  onNavigate?: (entry: TripEntry) => void;
  onSignOut: () => void;
  onUserUpdated: (user: PublicUser) => void;
}

export default function AppShell({
  user,
  getAccessToken,
  client,
  entry,
  onNavigate,
  onSignOut,
  onUserUpdated,
}: AppShellProps) {
  // 默认落在「行程」而不是占位页，保证一登录就看见真实内容。
  const [tab, setTab] = useState<ShellTab>('trips');

  return (
    <div className="app-shell">
      {tab === 'trips' && (
        <TripWorkspace
          key={user.id}
          user={user}
          getAccessToken={getAccessToken}
          embedded
          entry={entry}
          onNavigate={onNavigate}
          onOpenProfile={() => setTab('profile')}
          onSignOut={onSignOut}
        />
      )}

      {tab === 'profile' && (
        <ProfilePage
          user={user}
          client={client}
          onBack={() => setTab('trips')}
          onSignOut={onSignOut}
          onUpdated={onUserUpdated}
        />
      )}

      {tab === 'home' && <HomePage client={client} />}

      {tab === 'footprints' && <FootprintPage client={client} />}

      <nav className="bottom-nav" aria-label="主导航">
        {SHELL_TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`nav-item ${tab === item.id ? 'active' : ''}`}
            aria-current={tab === item.id ? 'page' : undefined}
            onClick={() => setTab(item.id)}
          >
            <span className="nav-icon" aria-hidden="true">
              {item.icon}
            </span>
            {item.label}
          </button>
        ))}
      </nav>
    </div>
  );
}
