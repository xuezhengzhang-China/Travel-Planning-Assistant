import { History, RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { tripsApi } from '../../api/client';
import { useTranslation } from '../../i18n';

interface Activity {
  id: number;
  created_at: string;
  actor: string;
  action: string;
  details: Record<string, unknown>;
}

export default function TripActivityPanel({ tripId }: { tripId: number }) {
  const { t, language } = useTranslation();
  const [items, setItems] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const refresh = async () => {
    setLoading(true);
    try {
      const result = await tripsApi.activity(tripId) as { activities: Activity[] };
      setItems(result.activities || []);
      setFailed(false);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void refresh(); }, [tripId]);

  const summary = (item: Activity) => {
    const d = item.details || {};
    const target = String(d.name ?? d.place ?? '');
    const suffix = target ? ` · ${target}` : '';
    if (Array.isArray(d.fields) && d.fields.length) return `${suffix} · ${String(d.fields.join(', '))}`;
    const before = d.before && typeof d.before === 'object' ? d.before as Record<string, unknown> : {};
    const after = d.after && typeof d.after === 'object' ? d.after as Record<string, unknown> : {};
    const oldTime = before.place_time ?? before.assignment_time;
    const newTime = after.place_time ?? after.assignment_time;
    if (oldTime !== undefined || newTime !== undefined) return `${suffix} · ${String(oldTime ?? '—')} → ${String(newTime ?? '—')}`;
    if (d.fromDay !== undefined && d.toDay !== undefined) return `${suffix} · ${String(d.fromDay)} → ${String(d.toDay)}`;
    if (d.place_time || d.end_time) return `${suffix} · ${String(d.place_time || '—')}–${String(d.end_time || '—')}`;
    if (d.memberId) return `${suffix} · ID ${String(d.memberId)}`;
    return suffix;
  };

  return (
    <section className="border border-edge-faint bg-surface-secondary" style={{ borderRadius: 12, padding: 12 }}>
      <header style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 9 }}>
        <History size={14} className="text-content-muted" />
        <strong className="text-content-secondary" style={{ fontSize: 12, flex: 1 }}>{t('members.activityTitle')}</strong>
        <button type="button" onClick={() => void refresh()} disabled={loading} aria-label={t('members.activityRefresh')}
          className="text-content-muted" style={{ border: 0, background: 'transparent', cursor: 'pointer', padding: 3 }}>
          <RefreshCw size={13} />
        </button>
      </header>
      {loading ? <p className="text-content-faint" style={{ fontSize: 11 }}>{t('members.activityLoading')}</p> :
        failed ? <p role="alert" className="text-content-faint" style={{ fontSize: 11 }}>{t('common.error')}</p> :
          items.length === 0 ? <p className="text-content-faint" style={{ fontSize: 11, lineHeight: 1.5 }}>{t('members.activityEmpty')}</p> :
            <ol style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 220, overflowY: 'auto', margin: 0, padding: 0, listStyle: 'none' }}>
              {items.map((item) => {
                const actionKey = `members.activity.${item.action.replace(/^trip\.activity\./, '')}`;
                const translated = t(actionKey);
                const label = translated === actionKey ? t(item.action) : translated;
                const time = new Date(item.created_at.replace(' ', 'T') + (item.created_at.endsWith('Z') ? '' : 'Z'));
                return <li key={item.id} className="border-b border-edge-faint" style={{ paddingBottom: 7 }}>
                  <div className="text-content" style={{ fontSize: 11, lineHeight: 1.45 }}>
                    <strong>{item.actor}</strong> {label}{summary(item)}
                  </div>
                  <time className="text-content-faint" style={{ fontSize: 10 }}>
                    {Number.isNaN(time.getTime()) ? item.created_at : new Intl.DateTimeFormat(language || undefined, { dateStyle: 'short', timeStyle: 'short' }).format(time)}
                  </time>
                  {(item.details?.before || item.details?.snapshot) && <details style={{ marginTop: 3 }}>
                    <summary className="text-content-muted" style={{ fontSize: 10, cursor: 'pointer' }}>{t('members.activity.details')}</summary>
                    <pre className="text-content-faint" style={{ whiteSpace: 'pre-wrap', fontSize: 10, margin: '4px 0' }}>{JSON.stringify({ before: item.details.before, after: item.details.after ?? item.details.snapshot }, null, 2)}</pre>
                  </details>}
                </li>;
              })}
            </ol>}
    </section>
  );
}
