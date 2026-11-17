import type { BPlaces } from '@travel/shared';
import './trip-transit.css';

export default function TripTransitSteps({ steps }: { steps?: BPlaces.TransitStep[] }) {
  if (!steps?.length) return <p>乘车详情暂未取得，可在高德查看这段路线。</p>;
  return (
    <ol className="trip-transit-steps" aria-label="公共交通乘车步骤">
      {steps.map((step, index) => (
        <li key={index} data-mode={step.mode}>
          <strong>{step.name}</strong>
          {step.departureStop && (
            <span>
              {step.departureStop}
              {step.entrance && ` · ${step.entrance}`} 上车
            </span>
          )}
          {step.arrivalStop && (
            <span>
              {step.arrivalStop}
              {step.exit && ` · ${step.exit}`} 下车
            </span>
          )}
          <small>
            {[
              step.stopCount !== undefined ? `途经 ${step.stopCount} 站` : '',
              step.distanceMeters !== undefined ? `${step.distanceMeters} 米` : '',
              step.durationMinutes !== undefined ? `约 ${step.durationMinutes} 分钟` : '',
            ]
              .filter(Boolean)
              .join(' · ')}
          </small>
          {step.serviceNotice && <span className="trip-transit-notice">{step.serviceNotice}</span>}
        </li>
      ))}
    </ol>
  );
}
