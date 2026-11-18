import { useEffect, useMemo, useState } from 'react';
import { loadDestinations } from './destinations';
import type { Destination, ProvinceDestinations } from './destinations';
import FoldSection from './FoldSection';

export default function DestinationPicker({ value, onChange }: { value: string; onChange: (name: string, destination?: Destination) => void }) {
  const [directory, setDirectory] = useState<ProvinceDestinations[]>([]);
  const [province, setProvince] = useState('');
  const [query, setQuery] = useState('');
  const [includeCounties, setIncludeCounties] = useState(false);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    setError('');
    loadDestinations().then(result => { if (active) setDirectory(result); }).catch(() => { if (active) setError('城市目录加载失败，你仍可直接输入目的地。'); });
    return () => { active = false; };
  }, [retry]);
  const groups = useMemo(() => directory.filter(group => !province || group.code === province).map(group => {
    const choices = [...new Map([...group.cities, ...(includeCounties || query ? group.counties : [])].map(item => [item.code, item])).values()];
    return { ...group, choices: choices.filter(item => !query || `${group.name}${item.name}`.includes(query.trim())) };
  }).filter(group => group.choices.length), [directory, province, query, includeCounties]);
  return <div className="destination-picker">
    <label htmlFor="trip-destination">你想去哪个城市？</label><input id="trip-destination" value={value} onChange={event => onChange(event.target.value)} placeholder="搜索选择，或直接填写目的地" />
    <p className="field-hint">已选：{value || '还没有选择'}。支持全国省市县目录，也可以填写自定义目的地。</p>
    <FoldSection title="按省份发现目的地" hint="城市 / 县区">
      <div className="destination-filters"><label>省份<select value={province} onChange={event => setProvince(event.target.value)}><option value="">全部省份</option>{directory.map(group => <option key={group.code} value={group.code}>{group.name}</option>)}</select></label><label>搜索城市或县区<input value={query} onChange={event => setQuery(event.target.value)} placeholder="例如：兰州、敦煌、延吉" /></label></div>
      <label className="feature-checkbox"><input type="checkbox" checked={includeCounties} onChange={event => setIncludeCounties(event.target.checked)} />同时浏览县区、县级市</label>
      {error && <p role="alert">{error}<button type="button" className="secondary-button" onClick={() => setRetry(retry + 1)}>重试</button></p>}
      {!directory.length && !error && <p role="status">正在读取本地城市目录…</p>}
      <div className="destination-groups">{groups.map(group => <FoldSection key={`${group.code}-${Boolean(query)}-${province}`} title={group.name} hint={`${group.choices.length} 个目的地`} defaultOpen={Boolean(query || province)}><div className="destination-grid">{group.choices.map(city => <button type="button" key={city.code} className={value === city.name ? 'choice-active' : 'choice-button'} onClick={() => onChange(city.name, city)}><span>{city.name}</span><small>{city.level === 'county' ? '县区 / 县级市' : '城市 / 地区'}</small></button>)}</div></FoldSection>)}</div>
      {directory.length > 0 && !groups.length && <p className="field-hint">没有匹配结果，可直接在上方填写目的地。</p>}
      <p className="field-hint">大陆省市县名单基于 2023 年公开区划；港澳台补充常用目的地。区划变更后的名称也可直接输入。</p>
    </FoldSection>
  </div>;
}
