import { useEffect, useState } from 'react';
import { getApiHealth } from './lib/api';

export default function App() {
  const [apiStatus, setApiStatus] = useState<'checking' | 'online' | 'offline'>('checking');

  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function check() {
      try {
        await getApiHealth(controller.signal);
        if (!controller.signal.aborted) setApiStatus('online');
      } catch {
        if (!controller.signal.aborted) setApiStatus('offline');
      } finally {
        if (!controller.signal.aborted) timer = setTimeout(check, 5000);
      }
    }
    void check();
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, []);

  return (
    <main className="shell">
      <div className="eyebrow">TRAVEL PLANNER · REBUILD</div>
      <h1>旅行规划助手</h1>
      <p className="intro">前后端开发骨架已就绪，后续按迭代计划逐步接入目的地、行程与地图服务。</p>
      <section className="status-card" aria-live="polite">
        <span className={`status-dot ${apiStatus}`} />
        <div>
          <strong>后端 API</strong>
          <p>
            {apiStatus === 'checking'
              ? '正在检查连接…'
              : apiStatus === 'online'
                ? '已连接'
                : '未连接，请启动后端服务'}
          </p>
        </div>
      </section>
      <p className="hint">
        地图 Key 可在本地 .env 中配置；浏览器端 Key 请在高德控制台设置域名白名单。
      </p>
    </main>
  );
}
