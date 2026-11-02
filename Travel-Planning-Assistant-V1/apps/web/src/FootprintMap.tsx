import { useEffect, useRef, useState } from 'react';
import type { FormEvent, PointerEvent } from 'react';
import { loadRegions, readVisits, readVideo } from './footprintData';
import type { Geography, Region, Visit } from './footprintData';
import { explorationCount, litCityCodes, loadTownships, readFootprints, relatedVisits, saveFootprints } from './footprintStore';
import type { Footprint, PlaceNode } from './footprintStore';
import './footprint.css';
import FoldSection from './FoldSection';

export function VisitVideo({ id }: { id: string }) {
  const [url, setUrl] = useState('');
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    let objectUrl = '';
    readVideo(id).then(blob => {
      if (!active) return;
      if (!blob) { setFailed(true); return; }
      objectUrl = URL.createObjectURL(blob); setUrl(objectUrl);
    }).catch(() => { if (active) setFailed(true); });
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [id]);
  return url ? <video src={url} controls preload="metadata" /> : <p>{failed ? '视频无法读取，请重新添加。' : '正在加载视频…'}</p>;
}

function rings(region: Region): number[][][] {
  return region.geometry.type === 'Polygon' ? region.geometry.coordinates as number[][][] : (region.geometry.coordinates as number[][][][]).flat();
}
const project = ([longitude, latitude]: number[]) => [longitude, -Math.log(Math.tan(Math.PI / 4 + latitude * Math.PI / 360)) * 180 / Math.PI];
const countryNames = new Intl.DisplayNames(['zh-CN'], { type: 'region' });
const countries = 'AF AL DZ AS AD AO AI AQ AG AR AM AW AU AT AZ BS BH BD BB BY BE BZ BJ BM BT BO BQ BA BW BV BR IO BN BG BF BI CV KH CM CA KY CF TD CL CN CX CC CO KM CG CD CK CR CI HR CU CW CY CZ DK DJ DM DO EC EG SV GQ ER EE SZ ET FK FO FJ FI FR GF PF TF GA GM GE DE GH GI GR GL GD GP GU GT GG GN GW GY HT HM VA HN HU IS IN ID IR IQ IE IM IL IT JM JP JE JO KZ KE KI KP KR KW KG LA LV LB LS LR LY LI LT LU MG MW MY MV ML MT MH MQ MR MU YT MX FM MD MC MN ME MS MA MZ MM NA NR NP NL NC NZ NI NE NG NU NF MK MP NO OM PK PW PS PA PG PY PE PH PN PL PT PR QA RE RO RU RW BL SH KN LC MF PM VC WS SM ST SA SN RS SC SL SG SX SK SI SB SO ZA GS SS ES LK SD SR SJ SE CH SY TJ TZ TH TL TG TK TO TT TN TR TM TC TV UG UA AE GB US UM UY UZ VU VE VN VG VI WF EH YE ZM ZW'.split(' ').map(code => ({ code, name: countryNames.of(code) || code })).sort((first, second) => first.name.localeCompare(second.name, 'zh-CN'));
const shades = ['#e8eae3', '#dde6d4', '#cbdcbd', '#b6cda6', '#9fba8f'];
const intensity = (count: number) => count === 0 ? 0 : count < 3 ? 1 : count < 6 ? 2 : count < 10 ? 3 : 4;
const municipalities = ['110000', '120000', '310000', '500000', '810000', '820000'];
const levels: Record<string, string> = { province: '省份', city: '城市', district: '县区', town: '乡镇街道' };

export default function FootprintMap() {
  const [footprints, setFootprints] = useState(readFootprints);
  const [country, setCountry] = useState('CN');
  const [stack, setStack] = useState<PlaceNode[]>([]);
  const [data, setData] = useState<Geography | null>(null);
  const [towns, setTowns] = useState<PlaceNode[]>([]);
  const [error, setError] = useState('');
  const [townError, setTownError] = useState('');
  const [retry, setRetry] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number; left: number; top: number; moved: boolean } | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [selected, setSelected] = useState<Footprint | null>(null);
  const [visits, setVisits] = useState<Visit[]>([]);
  const [journalCount, setJournalCount] = useState(() => readVisits().length);
  const [placing, setPlacing] = useState(false);
  const [pendingPoint, setPendingPoint] = useState<number[] | null>(null);
  const [spotName, setSpotName] = useState('');
  const current = stack.at(-1);
  const county = [...stack].reverse().find(node => node.level === 'district');
  const mapNode = current?.level === 'town' ? county : current;
  const code = mapNode ? `${mapNode.code}${mapNode.level === 'district' ? ':boundary' : ''}` : '100000';
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const wheel = (event: WheelEvent) => {
      if (!event.ctrlKey) return;
      event.preventDefault();
      setZoom(value => Math.max(1, Math.min(6, value * (event.deltaY < 0 ? 1.12 : 0.88))));
    };
    svg.addEventListener('wheel', wheel, { passive: false });
    return () => svg.removeEventListener('wheel', wheel);
  }, [data, country]);

  useEffect(() => {
    const updateMarks = () => setFootprints(readFootprints());
    const updateJournals = () => { const entries = readVisits(); setJournalCount(entries.length); if (selected) setVisits(relatedVisits(selected, entries)); };
    const updateAll = () => { updateMarks(); updateJournals(); };
    window.addEventListener('footprints-changed', updateMarks);
    window.addEventListener('journals-changed', updateJournals);
    window.addEventListener('storage', updateAll);
    return () => { window.removeEventListener('footprints-changed', updateMarks); window.removeEventListener('journals-changed', updateJournals); window.removeEventListener('storage', updateAll); };
  }, [selected]);
  useEffect(() => {
    let active = true;
    setData(null); setError(''); setZoom(1); setPan({ x: 0, y: 0 });
    setPlacing(false); setPendingPoint(null); setSelected(null);
    loadRegions(code).then(result => { if (active) setData(result); }).catch(() => { if (active) setError('区划地图暂时无法加载，请重试。已点亮的足迹仍保存在本地。'); });
    return () => { active = false; };
  }, [code, retry]);
  useEffect(() => {
    let active = true;
    setTowns([]); setTownError('');
    if (!county) return;
    loadTownships(county.code).then(result => { if (active) { setTowns(result); if (!result.length) setTownError('该县区暂无乡镇街道名单。'); } }).catch(() => { if (active) setTownError('本地乡镇名单读取失败，请重试。'); });
    return () => { active = false; };
  }, [county?.code, retry]);

  function persist(next: Footprint[]) {
    try { saveFootprints(next); setFootprints(next); setError(''); return true; }
    catch { setError('足迹保存失败，请检查浏览器存储空间。'); return false; }
  }
  function toggle(path: PlaceNode[]) {
    const leaf = path.at(-1)!;
    const id = `region:${leaf.code}`;
    const existing = footprints.find(footprint => footprint.id === id);
    const next = existing ? footprints.filter(footprint => footprint.id !== id) : [...footprints, { id, name: leaf.name, kind: 'region' as const, path, point: leaf.center, createdAt: new Date().toISOString() }];
    if (persist(next) && existing && selected?.id === id) setSelected(null);
  }
  function openMemories(footprint: Footprint) { setSelected(footprint); setVisits(relatedVisits(footprint, readVisits())); }
  function nodeFrom(region: Region): PlaceNode {
    const adcode = String(region.properties.adcode);
    const level = !current ? municipalities.includes(adcode) ? 'city' : 'province' : current.level === 'province' ? region.properties.level === 'district' ? 'district' : 'city' : 'district';
    return { code: adcode, name: region.properties.name, level, center: region.properties.centroid || region.properties.center };
  }
  const nodes = current?.level === 'district' || current?.level === 'town' ? towns : data?.features.filter(region => region.properties.adcode && region.properties.name).map(nodeFrom) || [];
  const visible = footprints.filter(footprint => !current || footprint.path.some(node => node.code === (current.level === 'town' ? county?.code : current.code)));
  const points = data?.features.flatMap(feature => rings(feature).flatMap(ring => ring.map(project))) || [];
  const minX = Math.min(...points.map(point => point[0]));
  const maxX = Math.max(...points.map(point => point[0]));
  const minY = Math.min(...points.map(point => point[1]));
  const maxY = Math.max(...points.map(point => point[1]));
  const scale = Math.min(860 / (maxX - minX || 1), 520 / (maxY - minY || 1));
  const position = (point: number[]) => { const projected = project(point); return [70 + (projected[0] - minX) * scale, 45 + (projected[1] - minY) * scale]; };
  const path = (region: Region) => rings(region).map(ring => ring.map((point, index) => `${index ? 'L' : 'M'}${position(point).join(',')}`).join(' ') + 'Z').join(' ');
  const nodePath = (node: PlaceNode) => node.level === 'town' ? [...stack.filter(item => item.level !== 'town'), node] : [...stack, node];
  function enter(node: PlaceNode) { setStack(nodePath(node)); setSelected(null); setPlacing(false); setPendingPoint(null); }
  function mapClick(event: PointerEvent<SVGSVGElement>) {
    const gesture = drag.current;
    drag.current = null;
    if (!placing || !gesture || gesture.moved) return;
    if (!(event.target as Element).classList.contains('atlas-region')) { setError('请在当前区划范围内选择位置。'); return; }
    const matrix = event.currentTarget.getScreenCTM();
    if (!matrix) return;
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
    const longitude = (point.x - 70) / scale + minX;
    const projectedLatitude = (point.y - 45) / scale + minY;
    const latitude = (2 * Math.atan(Math.exp(-projectedLatitude * Math.PI / 180)) - Math.PI / 2) * 180 / Math.PI;
    setPendingPoint([longitude, latitude]); setSpotName('');
  }
  function addSpot(event: FormEvent) {
    event.preventDefault();
    if (!spotName.trim() || !pendingPoint || !current) return;
    const footprint: Footprint = { id: `spot:${crypto.randomUUID()}`, name: spotName.trim(), kind: 'spot', path: stack, point: pendingPoint, createdAt: new Date().toISOString() };
    if (persist([...footprints, footprint])) { setPendingPoint(null); setPlacing(false); openMemories(footprint); }
  }

  return <>
    <div className="footprint-summary"><div><strong>{footprints.length ? 1 : 0}</strong><span>已点亮国家</span></div><div><strong>{litCityCodes(footprints).length}</strong><span>已点亮城市</span></div><div><strong>{journalCount}</strong><span>旅行记录</span></div></div>
    <section className="atlas-panel" aria-label="旅行足迹地图">
      <label className="atlas-country">探索国家<select value={country} onChange={event => setCountry(event.target.value)}>{countries.map(item => <option key={item.code} value={item.code}>{item.name}{item.code !== 'CN' ? ' · 待开放' : ''}</option>)}</select></label>
      {country !== 'CN' ? <div className="atlas-coming"><h3>{countryNames.of(country)}的旅行地图正在筹备</h3><button onClick={() => setCountry('CN')}>返回中国地图</button></div> : <>
        <nav className="atlas-breadcrumb"><button onClick={() => setStack([])}>中国</button>{stack.map((node, index) => <span key={node.code}> › <button onClick={() => { setStack(stack.slice(0, index + 1)); setSelected(null); }}>{node.name}</button></span>)}</nav>
        <div className="atlas-tools"><button aria-label="放大地图" onClick={() => setZoom(value => Math.min(6, value * 1.3))}>＋</button><button aria-label="缩小地图" onClick={() => setZoom(value => Math.max(1, value / 1.3))}>−</button><button onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }}>重置视图</button><span>{Math.round(zoom * 100)}%</span></div>
        <div className="atlas-selection">{current ? <><strong>{current.name}</strong><span>{levels[current.level]}</span><button onClick={() => toggle(stack)}>{footprints.some(footprint => footprint.id === `region:${current.code}`) ? '取消此地点亮' : '我去过，点亮这里'}</button><button disabled={!data} aria-pressed={placing} onClick={() => { setPlacing(!placing); setPendingPoint(null); }}>{placing ? '退出选点' : '在地图上标记具体地点'}</button></> : <span>选择一个省份或直辖市，开始点亮你的足迹。</span>}</div>
        <p className="journal-intro">点亮足迹不需要写手账。点击地图或下方名称查看区划，点击“点亮”记录到访；水滴用于查看相关回忆。</p>
        {placing && <p role="status" className="atlas-placement-hint">请在地图上点击去过的位置，再填写地点名称。无需识别地址或输入经纬度。</p>}
        {error && <p role="alert">{error}<button onClick={() => setRetry(retry + 1)}>重新加载地图</button></p>}
        {!data && !error && <p role="status">正在加载行政区划…</p>}
        {data && <>
          <svg ref={svgRef} className={`atlas-svg ${placing ? 'is-placing' : ''}`} viewBox={`${500 - 500 / zoom - pan.x} ${310 - 310 / zoom - pan.y} ${1000 / zoom} ${620 / zoom}`} onPointerDown={event => { if ((event.target as Element).closest('.atlas-pin')) return; drag.current = { x: event.clientX, y: event.clientY, left: pan.x, top: pan.y, moved: false }; }} onPointerMove={event => { const gesture = drag.current; if (!gesture) return; if (Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) > 5) gesture.moved = true; if (gesture.moved) { event.currentTarget.setPointerCapture(event.pointerId); const rect = event.currentTarget.getBoundingClientRect(); setPan({ x: gesture.left + (event.clientX - gesture.x) * 1000 / rect.width / zoom, y: gesture.top + (event.clientY - gesture.y) * 1000 / rect.width / zoom }); } }} onPointerUp={event => { const moved = drag.current?.moved; event.currentTarget.dataset.dragged = moved ? 'true' : 'false'; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); if (placing) mapClick(event); else drag.current = null; }} onPointerCancel={() => { drag.current = null; }} onClickCapture={event => { if (placing || event.currentTarget.dataset.dragged === 'true') { event.stopPropagation(); event.currentTarget.dataset.dragged = 'false'; } }} aria-label={mapNode?.name || '中国省级行政区划'}>
            {data.features.map((region, index) => { const regionCode = String(region.properties.adcode); const count = explorationCount(footprints, regionCode); const clickable = !county && Boolean(region.properties.adcode); return <g key={`${regionCode}-${index}`}><path d={path(region)} fillRule="evenodd" style={{ fill: shades[intensity(count)] }} className="atlas-region" role={clickable ? 'button' : undefined} tabIndex={clickable ? 0 : undefined} aria-label={region.properties.name} onClick={() => { if (clickable) enter(nodeFrom(region)); }} onKeyDown={event => { if (clickable && !placing && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); enter(nodeFrom(region)); } }}><title>{region.properties.name}{count ? ' · 已点亮' : ''}</title></path>{region.properties.name && (region.properties.centroid || region.properties.center) && <text className="atlas-label" x={position(region.properties.centroid || region.properties.center!)[0]} y={position(region.properties.centroid || region.properties.center!)[1]}>{region.properties.name}</text>}</g>; })}
            {visible.filter(footprint => footprint.point?.length === 2).map(footprint => { const [x, y] = position(footprint.point!); return <g key={footprint.id} transform={`translate(${x},${y}) scale(${1 / Math.sqrt(zoom)})`} className="atlas-pin" role="button" tabIndex={0} aria-label={`查看${footprint.name}的旅行记录`} onClick={() => openMemories(footprint)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openMemories(footprint); } }}><path d="M0 0 C-6 -9 -13 -15 -13 -23 A13 13 0 1 1 13 -23 C13 -15 6 -9 0 0Z" /><circle cy="-23" r="4" /><text y="18">{footprint.name}</text></g>; })}
            {pendingPoint && <circle className="atlas-pending" cx={position(pendingPoint)[0]} cy={position(pendingPoint)[1]} r={8 / zoom} />}
          </svg>
          <div className="atlas-legend">{['未点亮', '1–2', '3–5', '6–9', '10+'].map((label, index) => <span key={label}><i style={{ background: shades[index] }} />{label}</span>)}</div>
          <p className="journal-intro">地图和名称使用相同颜色分级，按独立点亮的下级地点数量加深；不会把一次点亮整个省份算作去过所有城市。区域水滴位于区划代表点，具体地点水滴位于你选择的位置。</p>
        </>}
        {pendingPoint && <form className="atlas-add-spot" onSubmit={addSpot}><label>地点名称<input autoFocus required maxLength={100} placeholder="例如：西湖、某个公园或一家小店" value={spotName} onChange={event => setSpotName(event.target.value)} /></label><button type="submit">点亮这个位置</button><button type="button" onClick={() => setPendingPoint(null)}>取消</button></form>}
        <FoldSection key={code} title={county ? "乡镇与街道" : current ? "下级行政区划" : "省份与直辖市"} hint={`${nodes.length} 个区划`}><div className="atlas-region-list">{nodes.map(node => { const count = explorationCount(footprints, node.code); const marked = footprints.some(footprint => footprint.id === `region:${node.code}`); return <div className="atlas-region-item" key={node.code} style={{ background: shades[intensity(count)] }}><button style={{ background: 'transparent' }} onClick={() => enter(node)}>{node.name}{count > 0 && <span> · 已点亮</span>}</button><button aria-label={`${marked ? '取消点亮' : '点亮'}${node.name}`} onClick={() => toggle(nodePath(node))}>{marked ? '✓ 已去过' : '＋ 点亮'}</button></div>; })}</div></FoldSection>
        {county && <p className="journal-intro">乡镇街道名单基于 2023 年公开区划，可独立点亮；当前暂无乡镇边界图，地图保留县区边界，不以虚构边界代替。{townError}</p>}
        {visible.length > 0 && <FoldSection title="已点亮的位置" hint={`${visible.length} 处足迹`} defaultOpen={false}><div className="atlas-region-list">{visible.map(footprint => <div className="atlas-region-item" key={footprint.id}><button onClick={() => openMemories(footprint)}>⌖ {footprint.name} · 查看回忆</button><button aria-label={`取消点亮${footprint.name}`} onClick={() => { if (persist(footprints.filter(item => item.id !== footprint.id)) && selected?.id === footprint.id) setSelected(null); }}>×</button></div>)}</div><p className="journal-intro">取消点亮只移除该标记，不删除手账或已独立点亮的下级地点。</p></FoldSection>}
        {selected && <section className="atlas-timeline"><h3>{selected.name} · 到访回忆</h3><p className="journal-intro">{selected.path.map(node => node.name).join(' / ')}</p>{!visits.length && <p className="atlas-empty">这里已经点亮，还没有关联手账。你可以只收藏足迹，也可以在写手账时选填“关联已点亮位置”。</p>}{visits.map((visit, index) => ({ visit, number: index + 1 })).reverse().map(({ visit, number }) => <article key={visit.id}><span className="atlas-visit-number">第 {number} 篇到访记录</span><time dateTime={visit.date}>{visit.date}</time><p className="journal-meta">{visit.companions}{visit.weather && ` · ${visit.weather}`}</p><p className="journal-body">{visit.thoughts}</p><div className="journal-photos">{visit.photos.map((photo, index) => <a key={index} href={photo} target="_blank" rel="noreferrer"><img src={photo} alt={`${visit.place}旅行照片 ${index + 1}`} /></a>)}</div>{visit.videos?.map(id => <VisitVideo key={id} id={id} />)}</article>)}</section>}
      </>}
      <p className="atlas-credit">行政区划：DataV.GeoAtlas · 乡镇名单：Administrative-divisions-of-China（2023） · 足迹与手账均保存在当前浏览器</p>
    </section>
  </>;
}
