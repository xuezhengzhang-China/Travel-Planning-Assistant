/** Seasonal schedule records for the curated Beijing catalogue.
 * Times are local Beijing time. Official pages change seasonally; unknown or
 * venue-specific hours are explicitly marked variable and are not hard-blocked.
 */
export type OpeningPeriod = {
  from: string;
  to: string;
  open: string;
  lastEntry: string;
  close: string;
};

export type OpeningHours = {
  status: 'seasonal' | 'daily' | 'variable';
  periods: OpeningPeriod[];
  closedWeekdays?: number[];
  note?: string;
};

const allYear = (open: string, lastEntry: string, close = lastEntry): OpeningHours => ({
  status: 'daily',
  periods: [{ from: '01-01', to: '12-31', open, lastEntry, close }],
});
const seasonal = (high: OpeningPeriod, low: OpeningPeriod, extra: Partial<OpeningHours> = {}): OpeningHours => ({
  status: 'seasonal',
  periods: [high, low],
  ...extra,
});
const highPark = { from: '04-01', to: '10-31', open: '06:00', lastEntry: '20:30', close: '21:00' };
const lowPark = { from: '11-01', to: '03-31', open: '06:30', lastEntry: '19:30', close: '20:00' };

export const BEIJING_ATTRACTION_HOURS: Record<
  string,
  {
    openingHours: OpeningHours;
    reservationRequired: boolean;
    reservationUrl?: string;
    hoursSourceUrl: string;
  }
> = {
  'palace-museum': {
    openingHours: seasonal(
      { from: '04-01', to: '10-31', open: '08:30', lastEntry: '16:10', close: '17:00' },
      { from: '11-01', to: '03-31', open: '08:30', lastEntry: '15:30', close: '16:30' },
      { closedWeekdays: [1], note: '周一闭馆，法定节假日及暑期安排以官方公告为准。' },
    ),
    reservationRequired: true,
    reservationUrl: 'https://ticket.dpm.org.cn/',
    hoursSourceUrl: 'https://english.beijing.gov.cn/specials/ticketing/museums/202407/t20240719_3752962.html',
  },
  'tiananmen-square': {
    openingHours: allYear('05:00', '21:00', '22:00'),
    reservationRequired: true,
    reservationUrl: 'https://yuyue.tamgw.beijing.gov.cn/',
    hoursSourceUrl: 'https://english.beijing.gov.cn/travellinginbeijing/attractions/202603/t20260325_4566109.html',
  },
  'national-museum': {
    openingHours: seasonal(
      { from: '06-01', to: '10-31', open: '09:00', lastEntry: '16:30', close: '17:30' },
      { from: '11-01', to: '05-31', open: '09:00', lastEntry: '16:00', close: '17:00' },
      {
        closedWeekdays: [1],
        note: '周一闭馆，节假日安排以官方公告为准。',
      },
    ),
    reservationRequired: true,
    reservationUrl: 'https://pcticket.chnmuseum.cn/',
    hoursSourceUrl: 'https://pcticket.chnmuseum.cn/',
  },
  'temple-of-heaven': {
    openingHours: {
      ...allYear('06:00', '21:00', '22:00'),
      note: '公园全年 06:00–22:00（21:00 停止入园）。祈年殿等收费景点通常周二至周日 08:00–18:00（17:30 停止入内），周一闭馆，法定节假日除外；园区与园中景点开放及票务时间不同。',
    },
    reservationRequired: false,
    hoursSourceUrl: 'https://english.beijing.gov.cn/specials/ticketing/parks/202407/t20240719_3753312.html',
  },
  'summer-palace': {
    openingHours: seasonal(
      { from: '04-01', to: '10-31', open: '06:00', lastEntry: '19:00', close: '20:00' },
      { from: '11-01', to: '03-31', open: '06:30', lastEntry: '18:00', close: '19:00' },
    ),
    reservationRequired: false,
    hoursSourceUrl: 'https://english.beijing.gov.cn/specials/ticketing/parks/202407/t20240719_3753037.html',
  },
  'old-summer-palace': {
    openingHours: seasonal(
      { from: '04-01', to: '10-31', open: '06:00', lastEntry: '19:00', close: '21:00' },
      { from: '11-01', to: '03-31', open: '06:30', lastEntry: '17:30', close: '19:30' },
    ),
    reservationRequired: false,
    hoursSourceUrl: 'https://english.beijing.gov.cn/specials/240tour/index.html',
  },
  'jingshan-park': {
    openingHours: seasonal(highPark, lowPark),
    reservationRequired: false,
    hoursSourceUrl: 'https://english.beijing.gov.cn/specials/ticketing/parks/202407/t20240719_3753324.html',
  },
  'beihai-park': {
    openingHours: seasonal(highPark, lowPark, { note: '园内景点有单独开放时间，且部分景点周一关闭。' }),
    reservationRequired: false,
    hoursSourceUrl:
      'https://english.beijing.gov.cn/specials/parktours/guidevisitors/beihaipark/overview/202301/t20230111_2896592.html',
  },
  'prince-gong-mansion': {
    openingHours: { ...allYear('08:30', '16:00', '16:30'), closedWeekdays: [1], note: '周一闭馆，法定节假日除外。' },
    reservationRequired: true,
    reservationUrl: 'https://english.beijing.gov.cn/specials/ticketing/index.html',
    hoursSourceUrl: 'https://english.beijing.gov.cn/specials/ticketing/index.html',
  },
  'yonghe-temple': {
    openingHours: seasonal(
      { from: '04-01', to: '10-31', open: '09:00', lastEntry: '16:30', close: '17:00' },
      { from: '11-01', to: '03-31', open: '09:00', lastEntry: '16:00', close: '16:30' },
    ),
    reservationRequired: false,
    hoursSourceUrl: 'https://english.beijing.gov.cn/specials/240tour/index.html',
  },
  'badaling-great-wall': {
    openingHours: seasonal(
      { from: '04-01', to: '10-31', open: '06:30', lastEntry: '16:30', close: '16:30' },
      { from: '11-01', to: '03-31', open: '07:30', lastEntry: '16:00', close: '16:00' },
    ),
    reservationRequired: false,
    hoursSourceUrl: 'https://english.beijing.gov.cn/travellinginbeijing/attractions/202603/t20260320_4562521.html',
  },
  'mutianyu-great-wall': {
    openingHours: seasonal(
      { from: '03-16', to: '11-15', open: '07:30', lastEntry: '16:30', close: '18:00' },
      { from: '11-16', to: '03-15', open: '08:00', lastEntry: '16:00', close: '17:30' },
    ),
    reservationRequired: false,
    hoursSourceUrl: 'https://english.beijing.gov.cn/travellinginbeijing/attractions/202603/t20260325_4566115.html',
  },
  'olympic-park': {
    openingHours: seasonal(
      { from: '03-15', to: '11-15', open: '06:00', lastEntry: '21:00', close: '22:00' },
      { from: '11-16', to: '03-14', open: '06:00', lastEntry: '20:00', close: '21:00' },
      { note: '鸟巢、水立方为独立场馆，开放时间与门票以各场馆公告为准。' },
    ),
    reservationRequired: false,
    hoursSourceUrl: 'https://english.beijing.gov.cn/travellinginbeijing/attractions/202603/t20260320_4562517.html',
  },
  '798-art-zone': {
    openingHours: {
      status: 'variable',
      periods: [],
      note: '街区全天可步行进入；各画廊、展馆和商户营业时间不同，建议逐家确认。',
    },
    reservationRequired: false,
    hoursSourceUrl: 'https://english.beijing.gov.cn/specials/ticketing/index.html',
  },
  'beijing-zoo': {
    openingHours: seasonal(
      { from: '04-01', to: '10-31', open: '07:30', lastEntry: '18:00', close: '18:00' },
      { from: '11-01', to: '03-31', open: '07:30', lastEntry: '17:00', close: '17:00' },
    ),
    reservationRequired: true,
    reservationUrl: 'https://english.beijing.gov.cn/specials/ticketing/parks/202407/t20240719_3753321.html',
    hoursSourceUrl: 'https://english.beijing.gov.cn/specials/parktours/guidevisitors/beijingzoo/',
  },
  'qianmen': {
    openingHours: { status: 'variable', periods: [], note: '街区公共道路全天开放；店铺和场馆营业时间各异。' },
    reservationRequired: false,
    hoursSourceUrl: 'https://english.beijing.gov.cn/specials/240tour/index.html',
  },
  'ming-tombs': {
    openingHours: seasonal(
      { from: '04-01', to: '10-31', open: '08:30', lastEntry: '16:30', close: '17:30' },
      { from: '11-01', to: '03-31', open: '08:30', lastEntry: '15:30', close: '16:30' },
    ),
    reservationRequired: false,
    hoursSourceUrl: 'https://english.beijing.gov.cn/specials/ticketing/attractions/202407/t20240719_3753671.html',
  },
  'fragrant-hills': {
    openingHours: seasonal(
      { from: '04-01', to: '10-31', open: '06:00', lastEntry: '18:30', close: '19:00' },
      { from: '11-01', to: '03-31', open: '06:00', lastEntry: '18:00', close: '19:00' },
    ),
    reservationRequired: false,
    hoursSourceUrl: 'https://english.beijing.gov.cn/specials/ticketing/index.html',
  },
};

export const ATTRACTION_DATA_VERIFIED_AT = '2026-10-19';
