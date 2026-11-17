import type { Visit } from './footprintData';

export type PlaceNode = { code: string; name: string; level: string; center?: number[] };
export type Footprint = { id: string; name: string; kind: 'region' | 'spot'; path: PlaceNode[]; point?: number[]; createdAt: string };
export const footprintKey = 'wander-footprints-v1';

export function readFootprints(): Footprint[] {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(footprintKey) || '[]');
    return Array.isArray(saved) ? saved.filter((item): item is Footprint => item && typeof item.id === 'string' && typeof item.name === 'string' && ['region', 'spot'].includes(item.kind) && Array.isArray(item.path) && item.path.length > 0 && item.path.every((node: PlaceNode) => node && typeof node.code === 'string' && typeof node.name === 'string' && typeof node.level === 'string')) : [];
  } catch { return []; }
}

export function saveFootprints(footprints: Footprint[]) {
  localStorage.setItem(footprintKey, JSON.stringify(footprints));
  window.dispatchEvent(new Event('footprints-changed'));
}

export function explorationCount(footprints: Footprint[], code: string): number {
  const children = new Set<string>();
  let directlyMarked = false;
  for (const footprint of footprints) {
    const index = footprint.path.findIndex(node => node.code === code);
    if (index === -1) continue;
    const child = footprint.path[index + 1];
    if (child) children.add(child.code);
    else if (footprint.kind === 'spot') children.add(footprint.id);
    else directlyMarked = true;
  }
  return children.size || (directlyMarked ? 1 : 0);
}

export function litCityCodes(footprints: Footprint[]): string[] {
  return [...new Set(footprints.flatMap(footprint => footprint.path.filter(node => node.level === 'city').map(node => node.code)))];
}

export function relatedVisits(footprint: Footprint, visits: Visit[]): Visit[] {
  const normalize = (value: string) => value.replace(/[\s·,，、-]/g, '');
  return visits.filter(visit => {
    if (visit.footprintId) return visit.footprintId === footprint.id;
    const province = footprint.path.find(node => node.level === 'province');
    const city = footprint.path.find(node => node.level === 'city');
    if (visit.province && province && visit.province !== province.code) return false;
    if (visit.city && city && visit.city !== city.code) return false;
    const leaf = footprint.path.at(-1)!;
    if (footprint.kind === 'region' && leaf.level === 'province') return visit.province === leaf.code;
    if (footprint.kind === 'region' && leaf.level === 'city') return visit.city === leaf.code;
    const hasContext = (city && (visit.city === city.code || visit.place.includes(city.name.replace(/市$/, '')))) || (province && visit.province === province.code);
    return Boolean(hasContext && normalize(visit.place).includes(normalize(footprint.name)));
  }).reverse().sort((first, second) => first.date.localeCompare(second.date));
}

type Township = { code: string; name: string; areaCode: string };
let townships: Promise<Township[]> | undefined;
export async function loadTownships(county: string): Promise<PlaceNode[]> {
  townships ??= fetch(`${import.meta.env.BASE_URL}data/streets.json`).then(response => {
    if (!response.ok) throw new Error('乡镇名单加载失败');
    return response.json() as Promise<Township[]>;
  }).catch(error => { townships = undefined; throw error; });
  return (await townships).filter(town => town.areaCode === county).map(town => ({ code: town.code, name: town.name, level: 'town' }));
}
