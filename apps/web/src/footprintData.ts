export type Region = { type: 'Feature'; properties: { adcode: number; name: string; center?: number[]; centroid?: number[]; level?: string }; geometry: { type: string; coordinates: number[][][] | number[][][][] } };
export type Geography = { type: string; features: Region[] };
export type Visit = { id: string; date: string; place: string; companions: string; weather: string; thoughts: string; photos: string[]; province?: string; city?: string; longitude?: string; latitude?: string; videos?: string[]; footprintId?: string };
export const journalKey = 'wander-travel-journals';
const cache = new Map<string, Promise<Geography>>();
export function loadRegions(code: string): Promise<Geography> {
  if (!cache.has(code)) {
    const boundaryOnly = code.endsWith(':boundary');
    const adcode = code.replace(':boundary', '');
    cache.set(code, fetch(`https://geo.datav.aliyun.com/areas_v3/bound/${adcode}${boundaryOnly ? '' : '_full'}.json`, { signal: AbortSignal.timeout(12000) }).then(response => {
      if (!response.ok) throw new Error('地图数据暂时无法加载');
      return response.json();
    }).then((data: Geography) => {
      if (!Array.isArray(data.features)) throw new Error('地图数据格式异常');
      return data;
    }).catch(error => { cache.delete(code); throw error; }));
  }
  return cache.get(code)!;
}
export function readVisits(): Visit[] {
  try {
    const data: unknown = JSON.parse(localStorage.getItem(journalKey) || '[]');
    const visits = Array.isArray(data) ? data.filter((item): item is Visit => item && typeof item.id === 'string' && typeof item.date === 'string' && typeof item.place === 'string' && Array.isArray(item.photos)) : [];
    return visits;
  } catch { return []; }
}
function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('wander-media', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('videos');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
export async function storeVideo(file: File): Promise<string> {
  const db = await database();
  const id = crypto.randomUUID();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction('videos', 'readwrite');
      transaction.objectStore('videos').put(file, id);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
    return id;
  } finally { db.close(); }
}
export async function readVideo(id: string): Promise<Blob | undefined> {
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction('videos').objectStore('videos').get(id);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } finally { db.close(); }
}
