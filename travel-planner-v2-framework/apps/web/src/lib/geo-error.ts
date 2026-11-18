/**
 * 把浏览器的定位错误翻译成用户能行动的一句话。
 *
 * 拒绝授权、系统定位关闭、超时，原来都显示同一句“定位失败，请允许定位权限”，
 * 用户无法判断到底卡在哪一步，所以这里按 GeolocationPositionError.code 分开说明。
 */
export function describeGeolocationError(error: GeolocationPositionError | null): string {
  switch (error?.code) {
    case 1: // PERMISSION_DENIED
      return '定位权限被拒绝。请点浏览器地址栏左侧的图标，把「位置」改为允许，然后重试。';
    case 2: // POSITION_UNAVAILABLE
      return '系统无法获取当前位置。请检查 Windows「设置 → 隐私和安全性 → 定位」是否已开启。';
    case 3: // TIMEOUT
      return '定位超时。请在网络更好的地方重试，或手动填写经纬度。';
    default:
      return '定位失败（未知原因）。请手动填写经纬度，或稍后重试。';
  }
}
