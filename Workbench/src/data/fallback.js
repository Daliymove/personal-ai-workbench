const unavailableMetrics = {
  raw: null,
  wiki: null,
  topics: null,
  candidates: null,
  filmed: null,
  publishedWorks: null,
  runs: null,
  totalPlays: null,
  profileVisits: null,
  profileVisitsIsLowerBound: false,
  knowledgeContribution: null,
};

export const fallbackOverview = {
  generatedAt: null,
  metrics: unavailableMetrics,
  wikiStatus: {
    active: null,
    needsReview: null,
    deprecated: null,
  },
  recent: [],
  activity: [],
  douyinAvailable: false,
  douyinQualityFlags: ["data_service_unavailable"],
  douyinTrend: [],
  douyinTrendTitle: "抖音作品数据",
  dataProvenance: null,
  qualityNotices: ["本地数据服务不可用，未展示任何统计数据。"],
};

export const fallbackCollections = {
  materials: [],
  wiki: [],
  content: [],
  archive: [],
};

export const fallbackSearchResults = [];

export const fallbackDouyinWorks = [];
