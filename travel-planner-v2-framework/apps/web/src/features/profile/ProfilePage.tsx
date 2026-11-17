import { useEffect, useState } from 'react';
import type { PublicUser } from '@travel/shared';
import type { ApiClient } from '../../lib/api-client';
import { createProfileApi, MAX_DISPLAY_NAME, profileErrorMessage } from '../../lib/profile-client';
import './profile.css';

export interface ProfilePageProps {
  /** 登录时得到的用户，用作首屏内容，避免白屏等待。 */
  user: PublicUser;
  client: ApiClient;
  onBack: () => void;
  onSignOut: () => void;
  /** 保存成功后回传最新用户，让上层（登录态）同步。 */
  onUpdated: (user: PublicUser) => void;
}

interface Counts {
  trips: number | null;
  footprints: number | null;
}

/**
 * 「我的」页：V1 的版式 + 统一客户端的真实数据。
 *
 * 端到端验证的是这条链路：登录态 → `ApiClient` 注入 token → `GET /api/users/me`
 * → 页面渲染 → 改名 `PATCH /api/users/me` → 上层登录态同步。
 */
export default function ProfilePage({
  user,
  client,
  onBack,
  onSignOut,
  onUpdated,
}: ProfilePageProps) {
  const [current, setCurrent] = useState<PublicUser>(user);
  const [displayName, setDisplayName] = useState(user.displayName ?? '');
  const [counts, setCounts] = useState<Counts>({ trips: null, footprints: null });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [fontSize, setFontSize] = useState(
    () => localStorage.getItem('wander-font-size') || 'medium',
  );
  const [theme, setTheme] = useState(() => localStorage.getItem('wander-theme') || 'green');

  useEffect(() => {
    try {
      localStorage.setItem('wander-font-size', fontSize);
    } catch {
      /* 忽略存储失败 */
    }
    document.documentElement.dataset.font = fontSize;
  }, [fontSize]);

  useEffect(() => {
    try {
      localStorage.setItem('wander-theme', theme);
    } catch {
      /* 忽略存储失败 */
    }
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    let active = true;
    createProfileApi(client)
      .getMe()
      .then((fresh) => {
        if (!active) return;
        setCurrent(fresh);
        setDisplayName(fresh.displayName ?? '');
      })
      .catch((failure: unknown) => {
        if (active) setError(profileErrorMessage(failure));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [client]);

  // 统计只是锦上添花：任一接口失败都退回「—」，不影响资料本身可用。
  useEffect(() => {
    let active = true;
    void Promise.allSettled([
      client.request<{ total: number }>('/trips?page=1&pageSize=1'),
      client.request<{ total: number }>('/footprints?page=1&pageSize=1'),
    ]).then(([trips, footprints]) => {
      if (!active) return;
      setCounts({
        trips: trips.status === 'fulfilled' ? trips.value.total : null,
        footprints: footprints.status === 'fulfilled' ? footprints.value.total : null,
      });
    });
    return () => {
      active = false;
    };
  }, [client]);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (saving || loading) return;
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const updated = await createProfileApi(client).rename(displayName);
      setCurrent(updated);
      setDisplayName(updated.displayName ?? '');
      onUpdated(updated);
      setEditing(false);
      setNotice('昵称已保存');
    } catch (failure) {
      setError(profileErrorMessage(failure));
    } finally {
      setSaving(false);
    }
  }

  const initial = (current.displayName ?? current.email).trim().slice(0, 1).toUpperCase();

  return (
    <section className="sub-page">
      <p className="eyebrow">YOUR SPACE</p>
      <h1 className="profile-title">我的</h1>

      {error && (
        <p role="alert" className="profile-alert">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="profile-notice">
          {notice}
        </p>
      )}

      {loading ? (
        <p role="status" className="profile-hint">
          正在读取账号信息…
        </p>
      ) : (
        <>
          <div className="profile-card">
            <div className="avatar" aria-hidden="true">
              {initial}
            </div>
            <div>
              <h2>{current.displayName ?? '未设置昵称'}</h2>
              <p>{current.email}</p>
            </div>
            <button
              type="button"
              className="profile-edit"
              disabled={saving}
              onClick={() => {
                setEditing(true);
                setNotice('');
                setError('');
              }}
            >
              编辑资料 →
            </button>
          </div>

          <div className="profile-stats">
            <div>
              <strong>{counts.trips ?? '—'}</strong>
              <span>行程</span>
            </div>
            <div>
              <strong>{counts.footprints ?? '—'}</strong>
              <span>足迹</span>
            </div>
            <div>
              <strong>—</strong>
              <span>收藏</span>
            </div>
          </div>

          {editing && (
            <form className="settings-card profile-form" onSubmit={(event) => void save(event)}>
              <h3>修改昵称</h3>
              <label>
                昵称
                <input
                  value={displayName}
                  maxLength={MAX_DISPLAY_NAME}
                  disabled={saving}
                  placeholder="例如：小张"
                  autoFocus
                  onChange={(event) => setDisplayName(event.target.value)}
                />
              </label>
              <p className="profile-hint">
                最多 {MAX_DISPLAY_NAME} 个字符，首尾空格会被自动去掉；数据来自{' '}
                <code>GET /api/users/me</code>。
              </p>
              <div className="profile-actions">
                <button type="button" disabled={saving} onClick={() => setEditing(false)}>
                  取消
                </button>
                <button type="submit" disabled={saving}>
                  {saving ? '正在保存…' : '保存昵称'}
                </button>
              </div>
            </form>
          )}

          <div className="settings-card">
            <h3>账号</h3>
            <button type="button" onClick={onBack}>
              <span aria-hidden="true">←</span>返回行程<i aria-hidden="true">›</i>
            </button>
            <button type="button" onClick={onSignOut}>
              <span aria-hidden="true">⏻</span>退出登录<i aria-hidden="true">›</i>
            </button>
          </div>

          <div className="settings-card">
            <h3>偏好设置</h3>
            <button
              type="button"
              onClick={() => {
                setEditing(true);
                setNotice('');
                setError('');
              }}
            >
              <span aria-hidden="true">♙</span>个人资料<i aria-hidden="true">›</i>
            </button>
            <div className="pref-row">
              <span className="pref-icon" aria-hidden="true">
                文
              </span>
              <span className="pref-label">字体与字号</span>
              <select value={fontSize} onChange={(event) => setFontSize(event.target.value)}>
                <option value="small">小</option>
                <option value="medium">标准</option>
                <option value="large">大</option>
              </select>
            </div>
            <div className="pref-row">
              <span className="pref-icon" aria-hidden="true">
                ☼
              </span>
              <span className="pref-label">主题颜色</span>
              <div className="theme-swatches">
                {(
                  [
                    ['green', '#587d65'],
                    ['blue', '#4a7ba6'],
                    ['orange', '#c88a4a'],
                    ['pink', '#b56a8c'],
                  ] as const
                ).map(([id, color]) => (
                  <button
                    key={id}
                    type="button"
                    className={`theme-swatch${theme === id ? ' active' : ''}`}
                    style={{ background: color }}
                    aria-label={`主题颜色 ${id}`}
                    aria-pressed={theme === id}
                    onClick={() => setTheme(id)}
                  />
                ))}
              </div>
            </div>
          </div>

          <p className="profile-version">WANDER · TRAVEL PLANNER</p>
        </>
      )}
    </section>
  );
}
