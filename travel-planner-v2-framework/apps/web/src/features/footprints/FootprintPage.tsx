import { useCallback, useState } from 'react';
import type { FootprintEntry } from '@travel/shared';
import type { ApiClient } from '../../lib/api-client';
import FootprintMapView from './FootprintMapView';
import FootprintEntryForm from './FootprintEntryForm';
import FootprintList from './FootprintList';
import JournalPage from './JournalPage';
import './footprint-page.css';

type FootprintView = 'map' | 'entry' | 'journal';

const VIEWS: readonly { id: FootprintView; label: string }[] = [
  { id: 'map', label: '足迹地图' },
  { id: 'entry', label: '记录足迹' },
  { id: 'journal', label: '旅行手账' },
];

export interface FootprintPageProps {
  client: ApiClient;
}

/**
 * 旅行足迹页：三个子视图「足迹地图 / 记录足迹 / 旅行手账」。
 * 「记录足迹」里，第一行是「新建足迹」按钮，点开后显示与编辑共用的表单，
 * 下方始终显示按最新在前排序的足迹列表。
 */
export default function FootprintPage({ client }: FootprintPageProps) {
  const [view, setView] = useState<FootprintView>('map');
  const [refreshToken, setRefreshToken] = useState(0);
  const [editing, setEditing] = useState<FootprintEntry | null>(null);
  const [showForm, setShowForm] = useState(false);
  const changed = useCallback(() => setRefreshToken((value) => value + 1), []);

  function startNew() {
    setEditing(null);
    setShowForm(true);
  }

  function startEdit(entry: FootprintEntry) {
    setEditing(entry);
    setShowForm(true);
  }

  function closeForm() {
    setShowForm(false);
    setEditing(null);
  }

  return (
    <section className="sub-page">
      <p className="eyebrow">YOUR TRAVEL MEMORIES</p>
      <div className="sub-page-title">
        <div>
          <h1>旅行足迹</h1>
          <p>走过的地方，都是生活的礼物。</p>
        </div>
      </div>

      <nav className="footprint-tabs" aria-label="足迹子导航">
        {VIEWS.map((item) => (
          <button
            key={item.id}
            type="button"
            className={view === item.id ? 'active' : ''}
            aria-current={view === item.id ? 'page' : undefined}
            onClick={() => setView(item.id)}
          >
            {item.label}
          </button>
        ))}
      </nav>

      {view === 'map' && <FootprintMapView client={client} refreshToken={refreshToken} />}

      {view === 'entry' && (
        <>
          <div className="footprint-entry-toolbar">
            <button type="button" className="primary-button" onClick={startNew}>
              ＋ 新建足迹
            </button>
          </div>
          {showForm && (
            <FootprintEntryForm
              key={editing?.id ?? 'new'}
              client={client}
              initialEntry={editing}
              onSaved={() => {
                changed();
                closeForm();
              }}
              onCancel={closeForm}
            />
          )}
          <FootprintList
            client={client}
            refreshToken={refreshToken}
            onChanged={changed}
            onEdit={startEdit}
          />
        </>
      )}

      {view === 'journal' && <JournalPage client={client} refreshToken={refreshToken} />}

      <p className="profile-version">WANDER · TRAVEL PLANNER</p>
    </section>
  );
}
