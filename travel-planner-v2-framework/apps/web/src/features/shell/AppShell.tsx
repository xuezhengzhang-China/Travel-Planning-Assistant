import { useState } from 'react';
import type { PublicUser } from '@travel/shared';
import type { ApiClient } from '../../lib/api-client';
import type { TripEntry } from '../trip-create/host-integration';
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

/**
 * 占位页：外壳先立起来，内容按 tab 逐个接入。
 *
 * 故意写清「下一步接哪个接口」，而不是空白一片——这样进度对谁都可见。
 */
function PendingPage({
  eyebrow,
  title,
  summary,
  todo,
}: {
  eyebrow: string;
  title: string;
  summary: string;
  todo: string;
}) {
  return (
    <section className="sub-page">
      <p className="eyebrow">{eyebrow}</p>
      <div className="sub-page-title">
        <div>
          <h1>{title}</h1>
          <p>{summary}</p>
        </div>
      </div>
      <div className="settings-card">
        <h3>待接入</h3>
        <p>{todo}</p>
      </div>
      <p className="profile-version">WANDER · TRAVEL PLANNER</p>
    </section>
  );
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

      {tab === 'home' && (
        <PendingPage
          eyebrow="YOUR TRAVEL ASSISTANT"
          title="旅行助手"
          summary="从一个目的地开始，看看这座城市能怎么玩。"
          todo="将接入 GET /api/destinations 与 GET /api/places，展示目的地目录、城市名片与推荐景点。"
        />
      )}

      {tab === 'footprints' && (
        <PendingPage
          eyebrow="YOUR TRAVEL MEMORIES"
          title="旅行足迹"
          summary="走过的地方，都是生活的礼物。"
          todo="将接入 GET /api/footprints/map（含 includeLocations=true）与足迹录入表单；无高德 Key 时需提示“城市归属不可用”。"
        />
      )}

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
