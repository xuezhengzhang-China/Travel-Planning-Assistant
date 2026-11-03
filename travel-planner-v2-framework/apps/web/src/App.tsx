import { useCallback, useEffect, useState } from 'react';
import type { LoginResponse } from '@travel/shared';
import TripWorkspace from './features/trip-create/TripWorkspace';
import { createSessionClient } from './features/trip-create/session-client';
import { tripErrorMessage } from './features/trip-create/trip-errors';
import { APP_NAME } from './features/trip-create/branding';
import { tripEntryFromPath, tripEntryPath, type TripEntry } from './features/trip-create';

const auth = createSessionClient();
const SESSION_KEY = 'travel:integration-session';
// 可替换的联调入口；正式软件使用自己的登录页，直接挂载 TripWorkspace。
export default function App() {
  const [session, setSession] = useState<LoginResponse | null>(null);
  const [checking, setChecking] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [registering, setRegistering] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [tripEntry, setTripEntry] = useState<TripEntry>(() =>
    tripEntryFromPath(window.location.pathname),
  );
  const navigateTrip = useCallback((entry: TripEntry) => {
    setTripEntry(entry);
    const path = tripEntryPath(entry);
    if (window.location.pathname !== path) window.history.pushState(null, '', path);
  }, []);
  useEffect(() => {
    const pop = () => setTripEntry(tripEntryFromPath(window.location.pathname));
    window.addEventListener('popstate', pop);
    return () => window.removeEventListener('popstate', pop);
  }, []);
  useEffect(() => {
    let active = true;
    async function restore() {
      try {
        const saved = JSON.parse(
          sessionStorage.getItem(SESSION_KEY) ?? 'null',
        ) as LoginResponse | null;
        if (saved?.accessToken && Date.parse(saved.expiresAt) > Date.now()) {
          const user = await auth.me(saved.accessToken);
          if (active) setSession({ ...saved, user });
        }
      } catch {
        /* 无有效会话时显示登录页。 */
      } finally {
        if (active) setChecking(false);
      }
    }
    void restore();
    return () => {
      active = false;
    };
  }, []);
  const getAccessToken = useCallback(
    () => (session && Date.parse(session.expiresAt) > Date.now() ? session.accessToken : null),
    [session],
  );
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      if (registering) await auth.register(email, password, displayName);
      const result = await auth.login(email, password);
      try {
        sessionStorage.setItem(SESSION_KEY, JSON.stringify(result));
      } catch {
        /* 仍可使用内存会话。 */
      }
      setPassword('');
      setSession(result);
    } catch (error) {
      setError(tripErrorMessage(error));
    } finally {
      setBusy(false);
    }
  }
  if (checking)
    return (
      <main className="trip-login" role="status">
        正在检查登录状态…
      </main>
    );
  if (session)
    return (
      <TripWorkspace
        key={session.user.id}
        user={session.user}
        getAccessToken={getAccessToken}
        entry={tripEntry}
        onNavigate={navigateTrip}
        onSignOut={() => {
          try {
            sessionStorage.removeItem(SESSION_KEY);
          } catch {
            /* 清理内存会话即可。 */
          }
          setSession(null);
          setTripEntry({ view: 'list' });
          setError('');
        }}
      />
    );
  return (
    <main className="trip-login">
      <h1>{APP_NAME}</h1>
      <p>登录后，新建、保存和继续编辑你的行程。</p>
      <form onSubmit={(event) => void submit(event)}>
        {registering && (
          <label>
            昵称
            <input
              required
              maxLength={80}
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              autoComplete="nickname"
            />
          </label>
        )}
        <label>
          邮箱
          <input
            type="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            autoComplete="username"
          />
        </label>
        <label>
          密码
          <input
            type="password"
            required
            minLength={registering ? 12 : 1}
            maxLength={128}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete={registering ? 'new-password' : 'current-password'}
          />
        </label>
        {registering && <p>密码至少 12 位。</p>}
        {error && (
          <p role="alert" className="workspace-error">
            {error}
          </p>
        )}
        <button className="workspace-primary" disabled={busy}>
          {busy ? '正在连接…' : registering ? '注册并登录' : '登录'}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            setRegistering(!registering);
            setError('');
          }}
        >
          {registering ? '已有账号' : '注册账号'}
        </button>
      </form>
    </main>
  );
}
