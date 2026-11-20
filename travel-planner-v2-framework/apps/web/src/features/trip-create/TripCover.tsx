import type { Destination, Trip } from '@travel/shared';
import beijingPhoto from '../../assets/beijing-cover.jpg';
import hangzhouPhoto from '../../assets/hangzhou-cover.jpg';
import { transportNames } from './trip-map-routes';
import './trip-cover.css';

const photos: Record<string, { src: string; title: string; author: string; source: string }> = {
  '110000': {
    src: beijingPhoto,
    title: '景山远眺故宫',
    author: 'Picrazy2',
    source: 'https://commons.wikimedia.org/wiki/File:Forbidden_City,_as_viewed_from_Jingshan.jpg',
  },
  '330100': {
    src: hangzhouPhoto,
    title: '西湖暮色',
    author: 'Yinweichen',
    source: 'https://commons.wikimedia.org/wiki/File:West_Lake_Panorama_at_Dusk.jpg',
  },
};

export default function TripCover({
  trip,
  city,
  onBack,
  onEdit,
  editDisabled,
}: {
  trip?: Trip;
  city?: Destination;
  onBack: () => void;
  onEdit: () => void;
  editDisabled: boolean;
}) {
  const coverCode = city?.adcode === '110100' ? '110000' : city?.adcode;
  const photo = coverCode && photos[coverCode];
  const { startDate, endDate } = trip?.planningInput ?? {};

  return (
    <>
      <header className="trip-cover" data-city={city?.adcode}>
        {photo && <img className="trip-cover-photo" src={photo.src} alt="" fetchPriority="high" />}
        <div className="trip-cover-toolbar">
          <button className="trip-detail-back" type="button" onClick={onBack}>
            <span aria-hidden="true">‹</span> 我的行程
          </button>
          {trip && (
            <button
              className="trip-cover-edit"
              type="button"
              onClick={onEdit}
              disabled={editDisabled}
            >
              编辑行程
            </button>
          )}
        </div>
        <div className="trip-cover-body">
          <div>
            {city && <p className="trip-cover-city">{city.name}</p>}
            <h1>{trip?.title ?? '行程详情'}</h1>
            {startDate && (
              <p className="trip-cover-dates">
                <time dateTime={startDate}>{startDate}</time>
                {endDate && endDate !== startDate && (
                  <>
                    {' '}
                    — <time dateTime={endDate}>{endDate}</time>
                  </>
                )}
              </p>
            )}
          </div>
          {photo && (
            <small
              className="trip-cover-credit"
              title={`来源 ${photo.source}\n许可 https://creativecommons.org/licenses/by-sa/4.0/`}
            >
              {photo.title} · {photo.author} / Wikimedia Commons · CC BY-SA 4.0
            </small>
          )}
        </div>
      </header>
      {trip?.status === 'planned' && (
        <dl className="trip-cover-overview" aria-label="行程概览">
          <div>
            <dt>行程天数</dt>
            <dd>
              {trip.days.length}
              <span> 天</span>
            </dd>
          </div>
          <div>
            <dt>已选景点</dt>
            <dd>
              {trip.planningInput.selectedPlaceIds.length}
              <span> 处</span>
            </dd>
          </div>
          <div>
            <dt>出行方式</dt>
            <dd>{transportNames[trip.planningInput.transportMode]}</dd>
          </div>
        </dl>
      )}
    </>
  );
}
