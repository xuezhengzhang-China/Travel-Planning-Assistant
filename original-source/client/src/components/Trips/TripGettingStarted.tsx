import { Check, MapPin, Route, UserPlus, X } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useTranslation } from '../../i18n';

interface Props {
  userId: number;
  placeCount: number;
  scheduledPlaceCount: number;
  memberCount: number;
  onAddPlace: () => void;
  onPlanRoute: () => void;
  onInvite: () => void;
}

export default function TripGettingStarted(props: Props) {
  const { t } = useTranslation();
  const storageKey = `tt-getting-started-v1:${props.userId}`;
  const [visible, setVisible] = useState(() => {
    try { return localStorage.getItem(storageKey) !== 'done'; } catch { return true; }
  });
  if (!visible) return null;

  const dismiss = () => {
    try { localStorage.setItem(storageKey, 'done'); } catch { /* browser storage may be disabled */ }
    setVisible(false);
  };
  const placeDone = props.placeCount > 0;
  const routeDone = props.scheduledPlaceCount >= 2;
  const inviteDone = props.memberCount > 1;

  const row = (done: boolean, label: string, icon: ReactNode, action?: () => void) => (
    <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '7px 0' }}>
      {done ? <Check size={16} className="text-green-600" /> : icon}
      <span className="text-content" style={{ flex: 1, fontSize: 12, textDecoration: done ? 'line-through' : undefined, opacity: done ? 0.65 : 1 }}>{label}</span>
      {!done && action && <button type="button" onClick={action} className="text-accent" style={{ border: 0, background: 'transparent', cursor: 'pointer', fontSize: 11, fontWeight: 700 }}>{t('trip.gettingStarted.start')}</button>}
    </div>
  );

  return (
    <aside role="dialog" aria-label={t('trip.gettingStarted.title')} className="tt-getting-started border border-edge bg-surface-card text-content shadow-xl"
      style={{ position: 'fixed', zIndex: 60, top: 'calc(var(--nav-h) + 54px)', right: 390, width: 330, maxWidth: 'calc(100vw - 24px)', borderRadius: 14, padding: 14 }}>
      <style>{`@media (max-width: 900px) { .tt-getting-started { right: 12px !important; } }`}</style>
      <button type="button" aria-label={t('common.close')} onClick={dismiss} className="text-content-faint" style={{ position: 'absolute', right: 10, top: 10, border: 0, background: 'transparent', cursor: 'pointer' }}><X size={15} /></button>
      <strong style={{ fontSize: 14 }}>{t('trip.gettingStarted.title')}</strong>
      <p className="text-content-muted" style={{ fontSize: 11, lineHeight: 1.5, margin: '4px 22px 8px 0' }}>{t('trip.gettingStarted.subtitle')}</p>
      {row(true, t('trip.gettingStarted.create'), <Check size={16} />)}
      {row(placeDone, t('trip.gettingStarted.addPlace'), <MapPin size={15} className="text-accent" />, props.onAddPlace)}
      {row(routeDone, t('trip.gettingStarted.route'), <Route size={15} className="text-accent" />, props.onPlanRoute)}
      {row(inviteDone, t('trip.gettingStarted.invite'), <UserPlus size={15} className="text-accent" />, props.onInvite)}
      <button type="button" onClick={dismiss} className="text-content-muted" style={{ marginTop: 6, border: 0, background: 'transparent', cursor: 'pointer', fontSize: 11 }}>{t('trip.gettingStarted.dismiss')}</button>
    </aside>
  );
}
