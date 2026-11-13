const fixture = require('../../../../docs/examples/demo-scenario.json');
const { readBConfig } = require('../../dist/b/config.js');
const { PlacesService } = require('../../dist/places/places.service.js');
const { RecommendationsService } = require('../../dist/recommendations/recommendations.service.js');
const { planRule, RouteNeeded, routeKey } = require('../../dist/recommendations/rule-planner.js');
const { LlmAdvisor } = require('../../dist/integrations/llm/llm.advisor.js');

function memoryCatalog() {
  const data = structuredClone(fixture);
  function page(items, query) {
    return {
      items: items.slice((query.page - 1) * query.pageSize, query.page * query.pageSize),
      page: query.page,
      pageSize: query.pageSize,
      total: items.length,
    };
  }
  return {
    data,
    async destinations(q) {
      return page(
        data.destinations.filter(
          (d) =>
            (!q.level || d.level === q.level) &&
            (!q.parentId || d.parentId === q.parentId) &&
            (!q.keyword || d.name.includes(q.keyword)),
        ),
        q,
      );
    },
    async places(q) {
      const score = (p) => p.categories.filter((c) => q.themes.includes(c)).length;
      return page(
        data.places
          .filter(
            (p) =>
              p.cityId === q.cityId &&
              (!q.category || p.categories.includes(q.category)) &&
              (!q.keyword || p.name.includes(q.keyword)),
          )
          .sort((a, b) => score(b) - score(a) || a.id.localeCompare(b.id)),
        q,
      );
    },
    async getCity(id) {
      return data.destinations.find((d) => d.id === id && d.level === 'city') ?? null;
    },
    async getPlaces(ids) {
      return data.places.filter((p) => ids.includes(p.id));
    },
    async getRouteCityCode() {
      return '0571';
    },
    async cityForAdminCode(code) {
      return ['330100', '330106', '330110'].includes(code) ? data.destinations[1] : null;
    },
  };
}
function memoryProposals() {
  const data = new Map();
  return {
    data,
    async save(userId, proposal) {
      data.set(proposal.proposalId, { userId, proposal: structuredClone(proposal) });
    },
    async getOwned(id, userId) {
      const row = data.get(id);
      return row?.userId === userId ? structuredClone(row.proposal) : null;
    },
  };
}
function fixedPlan(input = fixture.requests.recommendationRequest, places = fixture.places) {
  const routes = new Map();
  for (;;) {
    try {
      return planRule(input, places, routes);
    } catch (error) {
      if (!(error instanceof RouteNeeded)) throw error;
      routes.set(routeKey(error.from.id, error.to.id), {
        durationMinutes: 45,
        source: 'estimate',
        warnings: [{ code: 'ROUTE_ESTIMATED', message: 'Test estimate' }],
      });
    }
  }
}
function serviceFixture() {
  const catalog = memoryCatalog(),
    proposals = memoryProposals();
  const config = { values: readBConfig({}) };
  const places = new PlacesService(catalog);
  const geo = {
    route: async () => ({
      durationMinutes: 45,
      source: 'estimate',
      warnings: [{ code: 'ROUTE_ESTIMATED', message: 'Test estimate' }],
    }),
  };
  const clock = () => new Date(fixture.fixedNow);
  const advisor = new LlmAdvisor(config, async () => {
    throw new Error('Disabled model must not fetch');
  });
  const service = new RecommendationsService(
    places,
    geo,
    proposals,
    config,
    clock,
    () => fixture.responses.proposal.proposalId,
    advisor,
  );
  return { catalog, proposals, config, places, geo, service, advisor };
}
module.exports = { fixture, memoryCatalog, memoryProposals, fixedPlan, serviceFixture };
