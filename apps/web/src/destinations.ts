export type Destination = { code: string; name: string; provinceCode: string; provinceName: string; parentCode: string; level: 'city' | 'county' };
export type ProvinceDestinations = { code: string; name: string; cities: Destination[]; counties: Destination[] };
type AdministrativeNode = { code: string; name: string; children?: AdministrativeNode[] };
let directory: Promise<ProvinceDestinations[]> | undefined;

export function buildDestinationDirectory(data: AdministrativeNode[]): ProvinceDestinations[] {
  const result = data.map(province => {
    const provinceCode = province.code.padEnd(6, '0');
    const municipal = ['11', '12', '31', '50'].includes(province.code);
    const cities: Destination[] = municipal ? [{ code: provinceCode, name: province.name, provinceCode, provinceName: province.name, parentCode: '100000', level: 'city' }] : [];
    const counties: Destination[] = [];
    for (const city of province.children || []) {
      const cityCode = city.code.padEnd(6, '0');
      const direct = ['省直辖县级行政区划', '自治区直辖县级行政区划'].includes(city.name);
      if (!municipal && !direct) cities.push({ code: cityCode, name: city.name, provinceCode, provinceName: province.name, parentCode: provinceCode, level: 'city' });
      for (const county of city.children || []) {
        const destination: Destination = { code: county.code, name: county.name, provinceCode, provinceName: province.name, parentCode: municipal ? provinceCode : cityCode, level: 'county' };
        counties.push(destination);
        if (direct) cities.push({ ...destination, parentCode: provinceCode });
      }
    }
    return { code: provinceCode, name: province.name, cities, counties };
  });
  for (const [code, name, names] of [
    ['710000', '台湾省', ['台北市', '新北市', '桃园市', '台中市', '台南市', '高雄市', '基隆市', '新竹市', '嘉义市', '新竹县', '苗栗县', '彰化县', '南投县', '云林县', '嘉义县', '屏东县', '宜兰县', '花莲县', '台东县', '澎湖县', '金门县', '连江县']],
    ['810000', '香港特别行政区', ['香港']],
    ['820000', '澳门特别行政区', ['澳门']],
  ] as [string, string, string[]][]) {
    result.push({ code, name, cities: names.map((city, index) => ({ code: names.length === 1 ? code : `${code}-${index + 1}`, name: city, provinceCode: code, provinceName: name, parentCode: '100000', level: 'city' })), counties: [] });
  }
  return result;
}

export function loadDestinations(): Promise<ProvinceDestinations[]> {
  directory ??= fetch(`${import.meta.env.BASE_URL}data/pca-code.json`).then(response => {
    if (!response.ok) throw new Error('城市目录加载失败');
    return response.json() as Promise<AdministrativeNode[]>;
  }).then(buildDestinationDirectory).catch(error => { directory = undefined; throw error; });
  return directory;
}
