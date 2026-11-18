import { useEffect, useState } from 'react';
import type { ChangeEvent, FormEvent } from 'react';
import { readVisits, storeVideo } from './footprintData';
import type { Visit } from './footprintData';
import { readFootprints } from './footprintStore';
import { VisitVideo } from './FootprintMap';
import './journal.css';

const storageKey = 'wander-travel-journals';
const maxPhotos = 24;
const emptyDraft = () => ({ date: new Date().toLocaleDateString('sv-SE'), place: '', companions: '', weather: '', thoughts: '', photos: [] as string[], videos: [] as string[], footprintId: '' });

async function preparePhoto(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('图片处理失败');
    context.fillStyle = '#ffffff'; context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.8);
  } finally { bitmap.close(); }
}

export default function TravelJournal() {
  const [entries, setEntries] = useState<Visit[]>(readVisits);
  const [draft, setDraft] = useState<Omit<Visit, 'id'>>(emptyDraft);
  const [editing, setEditing] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [photoSize, setPhotoSize] = useState('medium');
  const [footprints, setFootprints] = useState(readFootprints);
  useEffect(() => {
    const update = () => setFootprints(readFootprints());
    window.addEventListener('footprints-changed', update);
    window.addEventListener('storage', update);
    return () => { window.removeEventListener('footprints-changed', update); window.removeEventListener('storage', update); };
  }, []);

  function persist(next: Visit[]) {
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
      setEntries(next); window.dispatchEvent(new Event('journals-changed')); setError(''); return true;
    } catch { setError('保存失败，浏览器存储空间可能不足，请减少照片后重试。'); return false; }
  }
  async function addPhotos(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files || []);
    event.target.value = '';
    if (files.some(file => !file.type.startsWith('image/') || file.size > 20 * 1024 * 1024) || draft.photos.length + files.length > maxPhotos) { setError('最多添加 24 张图片，每张不超过 20 MB。'); return; }
    setLoading(true); setError('');
    try {
      const photos: string[] = [];
      for (const file of files) photos.push(await preparePhoto(file));
      setDraft(current => ({ ...current, photos: [...current.photos, ...photos] }));
    } catch { setError('图片读取失败，请重新选择。'); }
    finally { setLoading(false); }
  }
  async function addVideos(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files || []);
    event.target.value = '';
    if (files.some(file => !file.type.startsWith('video/') || file.size > 100 * 1024 * 1024) || (draft.videos?.length || 0) + files.length > 4) { setError('每篇最多 4 个视频，每个不超过 100 MB。'); return; }
    setLoading(true); setError('');
    try {
      const ids: string[] = [];
      for (const file of files) ids.push(await storeVideo(file));
      setDraft(current => ({ ...current, videos: [...(current.videos || []), ...ids] }));
    } catch { setError('视频保存失败，请检查浏览器剩余空间后重试。'); }
    finally { setLoading(false); }
  }
  function save(event: FormEvent) {
    event.preventDefault();
    if (loading) return;
    if (!draft.place.trim()) { setError('请填写旅行地点。'); return; }
    const entry = { ...draft, place: draft.place.trim(), id: editing || crypto.randomUUID() };
    const next = editing ? entries.map(item => item.id === editing ? entry : item) : [entry, ...entries];
    if (persist(next)) { setOpen(false); setEditing(null); setDraft(emptyDraft()); }
  }
  const editor = <form className="journal-editor" onSubmit={save}>
    <h3>{editing ? '编辑这段回忆' : '记录新的旅行回忆'}</h3>
    {error && <p className="journal-error" role="alert">{error}</p>}
    <div className="journal-fields">
      <label>旅行日期<input type="date" required value={draft.date} onChange={event => setDraft({ ...draft, date: event.target.value })} /></label>
      <label>旅行地点<input required maxLength={100} placeholder="例如：杭州 · 西湖" value={draft.place} onChange={event => setDraft({ ...draft, place: event.target.value })} /></label>
      <label>同行人（选填）<input maxLength={100} placeholder="和谁一起留下这段回忆？" value={draft.companions} onChange={event => setDraft({ ...draft, companions: event.target.value })} /></label>
      <label>天气（选填）<select value={draft.weather} onChange={event => setDraft({ ...draft, weather: event.target.value })}><option value="">暂不记录</option>{['晴天 ☀', '多云 ⛅', '阴天 ☁', '雨天 ☂', '雪天 ❄', '大风 🍃'].map(weather => <option key={weather}>{weather}</option>)}</select></label>
    </div>
    <label className="journal-link">关联已点亮位置（选填）<select value={draft.footprintId || ''} onChange={event => setDraft({ ...draft, footprintId: event.target.value })}><option value="">独立保存，不关联足迹</option>{draft.footprintId && !footprints.some(footprint => footprint.id === draft.footprintId) && <option value={draft.footprintId}>原关联位置已取消点亮（可保留或重新选择）</option>}{footprints.map(footprint => <option key={footprint.id} value={footprint.id}>{footprint.path.map(node => node.name).join(' / ')}{footprint.kind === 'spot' ? ` / ${footprint.name}` : ''}</option>)}</select></label>
    <p className="journal-intro">手账可以独立保存，无需识别位置，也不会自动点亮地图。选填关联位置后，点击该位置的水滴即可看到这篇记录。</p>
    <label className="journal-thoughts">旅行感想<textarea rows={5} maxLength={10000} placeholder="今天看到了什么？有什么想记住的瞬间……" value={draft.thoughts} onChange={event => setDraft({ ...draft, thoughts: event.target.value })} /></label>
    <div className="journal-photos">{draft.photos.map((photo, index) => <div className="journal-photo" key={index}><img src={photo} alt={`旅行照片 ${index + 1}`} /><button type="button" disabled={loading} aria-label={`移除照片 ${index + 1}`} onClick={() => setDraft({ ...draft, photos: draft.photos.filter((_, position) => position !== index) })}>×</button></div>)}</div>
    <label className="journal-upload">＋ 添加照片（{draft.photos.length}/{maxPhotos}）<input type="file" accept="image/*" multiple disabled={loading || draft.photos.length >= maxPhotos} onChange={addPhotos} /></label>
    <p className="journal-intro">最多 24 张，每张原图不超过 20 MB，自动压缩为最长边 1600 像素的静态照片；实际保存量取决于浏览器剩余空间。</p>
    {(draft.videos || []).map((id, index) => <div key={id}><VisitVideo id={id} /><button type="button" disabled={loading} className="secondary-button" onClick={() => setDraft({ ...draft, videos: draft.videos?.filter(video => video !== id) })}>移除视频 {index + 1}</button></div>)}
    <label className="journal-upload">＋ 添加视频（{draft.videos?.length || 0}/4）<input type="file" accept="video/*" multiple disabled={loading || (draft.videos?.length || 0) >= 4} onChange={addVideos} /></label>
    <p className="journal-intro">每个视频不超过 100 MB，保存在当前浏览器，可播放的格式取决于浏览器支持。</p>
    <div className="journal-actions"><button type="button" className="secondary-button" disabled={loading} onClick={() => { setOpen(false); setEditing(null); setError(''); }}>取消</button><button className="primary-button" disabled={loading}>{loading ? '正在处理…' : '保存回忆'}</button></div>
  </form>;
  return <div className={`travel-journal journal-size-${photoSize}`}>
    <div className="journal-heading"><h2>旅行手账</h2><button className="primary-button" disabled={open || loading} onClick={() => { setDraft(emptyDraft()); setEditing(null); setError(''); setOpen(true); }}>＋ 写一篇手账</button></div>
    <p className="journal-intro">把沿途的风景，和当时的心情一起收藏。</p>
    <label className="journal-size-control">照片展示大小<select value={photoSize} onChange={event => setPhotoSize(event.target.value)}><option value="small">小图</option><option value="medium">中图</option><option value="large">大图</option></select></label>
    {error && !open && <p className="journal-error" role="alert">{error}</p>}
    {open && !editing && editor}
    {!entries.length && !open && <div className="empty-journal">📷 <span>每一张照片，都可以成为旅行故事的开头。</span></div>}
    <div className="journal-list">{entries.map(entry => <article className="journal-card" key={entry.id}>{open && editing === entry.id ? editor : <>
      <time dateTime={entry.date}>{entry.date}</time><h3>{entry.place}</h3>
      <div className="journal-meta">{entry.companions && <span>同行 · {entry.companions}</span>}{entry.weather && <span>{entry.weather}</span>}{entry.footprintId && <span>关联足迹 · {footprints.find(footprint => footprint.id === entry.footprintId)?.name || '原位置已取消点亮'}</span>}</div>
      {entry.thoughts && <p className="journal-body">{entry.thoughts}</p>}
      <div className="journal-photos">{entry.photos.map((photo, index) => <a href={photo} target="_blank" rel="noreferrer" key={index}><img src={photo} alt={`${entry.place}的旅行照片 ${index + 1}`} /></a>)}</div>
      {entry.videos?.map(id => <VisitVideo key={id} id={id} />)}
      <div className="journal-actions"><button className="secondary-button" disabled={open || loading} onClick={() => { setDraft(entry); setEditing(entry.id); setError(''); setOpen(true); }}>编辑</button><button className="secondary-button" disabled={open || loading} onClick={() => { if (window.confirm('确定删除这篇手账吗？')) persist(entries.filter(item => item.id !== entry.id)); }}>删除</button></div>
    </>}</article>)}</div>
  </div>;
}
