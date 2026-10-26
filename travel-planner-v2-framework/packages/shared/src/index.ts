export interface ApiHealth {
  status: 'ok';
  service: 'travel-planner-api';
}

export interface ApiReady {
  status: 'ready';
  database: 'ok';
}

export interface ApiNotReady {
  status: 'unavailable';
  database: 'not-ready';
}
