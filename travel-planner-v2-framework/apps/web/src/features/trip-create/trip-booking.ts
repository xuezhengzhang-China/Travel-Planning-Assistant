export const bookingLabels = {
  pending: '待预约',
  booked: '已预约',
  unnecessary: '无需预约',
} as const;

export type BookingStatus = keyof typeof bookingLabels;
type Bookings = Record<string, BookingStatus>;

export function readBookings(key: string): Bookings {
  try {
    const entries = JSON.parse(localStorage.getItem(key) ?? '{}') as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(entries).filter(
        (entry): entry is [string, BookingStatus] =>
          typeof entry[1] === 'string' && Object.hasOwn(bookingLabels, entry[1]),
      ),
    );
  } catch {
    return {};
  }
}
