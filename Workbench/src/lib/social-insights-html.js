import { getAccentFamily } from "./theme.js";

const EXPORT_NOTICE = "这是从个人 AI 工作台导出的独立副本。为便于安全分享，本地路径、文档标识、私有来源索引和原报告入口未包含在文件中。";

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function text(value, fallback = "未提供") {
  const normalized = String(value ?? "").trim();
  return escapeHtml(normalized || fallback);
}

function number(value) {
  return value == null || value === "" ? "未提供" : Number(value).toLocaleString("zh-CN");
}

function items(values, { ordered = false, empty = "未提供" } = {}) {
  const entries = (values ?? []).filter((item) => String(item ?? "").trim());
  if (!entries.length) return `<p class="empty">${escapeHtml(empty)}</p>`;
  const tag = ordered ? "ol" : "ul";
  return `<${tag}>${entries.map((item) => `<li>${text(item)}</li>`).join("")}</${tag}>`;
}

function metaPills(values) {
  return `<div class="meta">${(values ?? []).filter(Boolean).map((item) => `<span>${text(item)}</span>`).join("")}</div>`;
}

function metrics(entries) {
  return `<dl class="metrics">${entries.map(([label, value]) => `<div><dt>${text(label)}</dt><dd>${text(value)}</dd></div>`).join("")}</dl>`;
}

function section(index, eyebrow, title, body) {
  return `<section><header class="section-heading"><span>${String(index).padStart(2, "0")} / ${text(eyebrow, "SECTION")}</span><h2>${text(title)}</h2></header>${body}</section>`;
}

function cards(entries, render, empty = "本报告未提供这一部分。") {
  if (!(entries ?? []).length) return `<p class="empty">${escapeHtml(empty)}</p>`;
  return `<div class="cards">${entries.map(render).join("")}</div>`;
}

function table(headers, rows, empty = "本报告未提供这一部分。") {
  if (!(rows ?? []).length) return `<p class="empty">${escapeHtml(empty)}</p>`;
  return `<div class="table-wrap"><table><thead><tr>${headers.map((header) => `<th>${text(header)}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((cell, index) => `<${index === 0 ? "th" : "td"}>${text(cell)}</${index === 0 ? "th" : "td"}>`).join("")}</tr>`).join("")}</tbody></table></div>`;
}

function qualityWarnings(warnings) {
  if (!(warnings ?? []).length) return "";
  return `<aside class="quality"><strong>解析提醒</strong>${items(warnings.map((item) => item.message))}</aside>`;
}

function documentShell({ title, kind, capturedAt, body }) {
  const accent = getAccentFamily().accent;
  const wash = getAccentFamily().accentWash;
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light">
  <meta name="generator" content="个人 AI 工作台 · 社媒洞察独立导出">
  <title>${text(title)} · ${text(kind)}</title>
  <style>
    :root{--paper:#fafafa;--surface:#fff;--ink:#0a0a0a;--soft:#52525b;--faint:#a1a1aa;--line:#e4e4e7;--accent:${accent};--wash:${wash};font-family:Inter,"Noto Sans SC","PingFang SC","Microsoft YaHei",system-ui,sans-serif;color:var(--ink);background:var(--paper)}
    *{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:var(--paper);color:var(--ink);line-height:1.72}main{width:min(1120px,calc(100% - 40px));margin:0 auto;padding:64px 0 88px}a{color:inherit}h1,h2,h3,p,blockquote{margin-top:0}h1{max-width:900px;margin-bottom:20px;font-size:clamp(38px,7vw,76px);line-height:1.04;letter-spacing:-.045em}h2{font-size:clamp(25px,4vw,38px);line-height:1.18;letter-spacing:-.025em}h3{font-size:19px;line-height:1.35}.export-mark{display:inline-flex;align-items:center;gap:10px;margin-bottom:42px;font:700 11px/1.2 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.14em}.export-mark::before{content:"";width:14px;height:14px;border-radius:4px;background:var(--accent);box-shadow:inset 0 0 0 4px var(--wash)}.hero{padding:32px 0 54px;border-top:2px solid var(--ink);border-bottom:1px solid var(--ink)}.eyebrow,.section-heading>span,.card>span{display:block;color:var(--accent);font:700 10px/1.3 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.14em;text-transform:uppercase}.hero-summary{max-width:880px;margin:28px 0 0;padding:24px 28px;border-left:4px solid var(--accent);background:var(--surface);font-size:clamp(18px,2.4vw,25px);line-height:1.55}.meta{display:flex;flex-wrap:wrap;gap:8px;margin:18px 0 0}.meta span{padding:6px 10px;border:1px solid var(--line);border-radius:999px;background:var(--surface);color:var(--soft);font-size:12px}.metrics{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:1px;margin:28px 0 0;background:var(--line);border:1px solid var(--line)}.metrics div{padding:18px;background:var(--surface)}.metrics dt{color:var(--soft);font-size:12px}.metrics dd{margin:4px 0 0;font:700 24px/1.1 ui-monospace,SFMono-Regular,Menlo,monospace}section{padding:52px 0;border-bottom:1px solid var(--line)}.section-heading{display:grid;grid-template-columns:minmax(180px,.7fr) minmax(0,2fr);gap:24px;align-items:start;margin-bottom:26px}.cards{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}.card{padding:24px;border:1px solid var(--line);border-radius:14px;background:var(--surface);break-inside:avoid}.card h3{margin:8px 0 14px}.card p:last-child{margin-bottom:0}.card dl{display:grid;gap:12px;margin:18px 0 0}.card dl div{padding-top:12px;border-top:1px solid var(--line)}.card dt{color:var(--faint);font-size:11px}.card dd{margin:4px 0 0}.card blockquote{margin:16px 0;padding:16px 18px;border-left:3px solid var(--accent);background:var(--wash)}.chain{display:grid;grid-template-columns:1fr auto 1fr auto 1fr;gap:12px;align-items:center}.chain i{color:var(--accent);font-style:normal}.chain div{height:100%;padding:16px;border:1px solid var(--line);background:var(--surface)}.chain span{display:block;margin-bottom:8px;color:var(--faint);font-size:11px}.table-wrap{overflow:auto;border:1px solid var(--line);border-radius:12px;background:var(--surface)}table{width:100%;border-collapse:collapse;min-width:760px}th,td{padding:13px 15px;border-bottom:1px solid var(--line);vertical-align:top;text-align:left;font-size:13px}thead th{background:#f4f4f5;color:var(--soft);font-size:11px}tbody th{min-width:120px}.split{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}.panel{padding:24px;border:1px solid var(--line);border-radius:14px;background:var(--surface)}ul,ol{padding-left:20px}.empty{padding:20px;border:1px dashed var(--line);color:var(--faint)}.quality{margin-top:28px;padding:18px 20px;border:1px solid var(--line);background:var(--surface)}.export-notice{margin-top:42px;padding:18px 20px;border:1px solid var(--line);color:var(--soft);font-size:12px}.export-notice strong{display:block;margin-bottom:5px;color:var(--ink)}footer.page-footer{display:flex;justify-content:space-between;gap:16px;padding-top:20px;color:var(--faint);font:10px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace}
    @media(max-width:720px){main{width:min(100% - 24px,1120px);padding-top:32px}.section-heading,.cards,.split{grid-template-columns:1fr}.chain{grid-template-columns:1fr}.chain i{transform:rotate(90deg);text-align:center}h1{font-size:40px}.hero-summary{padding:18px 20px}.card{padding:19px}footer.page-footer{flex-direction:column}}
    @media print{body{background:#fff}main{width:100%;padding:0}.card,.panel,.table-wrap{box-shadow:none}.export-notice{break-inside:avoid}}
  </style>
</head>
<body>
  <main data-social-export="1">
    <div class="export-mark">SOCIAL INSIGHTS · PORTABLE HTML</div>
    ${body}
    <div class="export-notice"><strong>独立副本说明</strong>${escapeHtml(EXPORT_NOTICE)}</div>
    <footer class="page-footer"><span>${text(kind)}</span><span>导出内容更新于 ${text(capturedAt)}</span></footer>
  </main>
</body>
</html>`;
}

export function buildSocialInsightStandaloneHtml(report) {
  const platforms = [report?.primaryPlatform, ...(report?.auxiliaryPlatforms ?? [])].filter(Boolean);
  const body = `
    <header class="hero">
      <span class="eyebrow">TOPIC DEEP DIVE · 已脱敏</span>
      <h1>${text(report?.title, "社媒主题档案")}</h1>
      <p>${text(report?.question, "未提供研究问题")}</p>
      ${metaPills([report?.status, report?.capturedAt, ...platforms])}
      <blockquote class="hero-summary">${text(report?.conclusion, "未提供一句话结论")}</blockquote>
      ${metrics([
        ["搜索结果", number(report?.sampleTotals?.searchResults)],
        ["评论 / 回复", number(report?.sampleTotals?.visibleNodes)],
        ["纳入分析", number(report?.sampleTotals?.usableUnits)],
      ])}
    </header>
    ${qualityWarnings(report?.parseWarnings)}
    ${section(1, "FINDINGS", "主要发现", cards(report?.findings, (finding, index) => `<article class="card"><span>判断 ${String(index + 1).padStart(2, "0")}</span><h3>${text(finding.title)}</h3>${items(finding.body, { empty: "未提供判断依据" })}</article>`))}
    ${section(2, "USER TASKS", "评论区需求地图", cards(report?.needs, (need) => `<article class="card"><span>${text(need.confidence, "未标注")}置信度</span><h3>${text(need.cluster)}</h3><p>${text(need.task)}</p><dl><div><dt>可见证据</dt><dd>${text(need.evidence)}</dd></div><div><dt>常见失败</dt><dd>${text(need.failure)}</dd></div></dl></article>`))}
    ${section(3, "VIEWPOINTS", "观点阵营", cards(report?.camps, (camp) => `<article class="card"><span>观点阵营</span><h3>${text(camp.name)}</h3><blockquote>${text(camp.judgment)}</blockquote><dl><div><dt>代表证据</dt><dd>${text(camp.evidence)}</dd></div><div><dt>可能盲点</dt><dd>${text(camp.blindSpot)}</dd></div></dl></article>`))}
    ${section(4, "COMMENT → REPLY", "一级评论与二级回复", cards(report?.commentReplyChains, (chain, index) => `<article class="card"><span>回复链 ${String(index + 1).padStart(2, "0")}</span><div class="chain"><div><span>一级评论</span>${text(chain.question)}</div><i>→</i><div><span>回复修正</span>${text(chain.reply)}</div><i>→</i><div><span>研究价值</span>${text(chain.value)}</div></div></article>`))}
    ${section(5, "PLATFORMS", "跨平台差异", cards(report?.platformDifferences, (item) => `<article class="card"><span>平台观察</span><h3>${text(item.platform)}</h3><dl><div><dt>主导表达</dt><dd>${text(item.expression)}</dd></div><div><dt>评论信号</dt><dd>${text(item.signal)}</dd></div><div><dt>本轮局限</dt><dd>${text(item.limitation)}</dd></div></dl></article>`))}
    ${section(6, "INDICATORS", "样本内可视化指标", table(["维度", "分数", "评分依据"], (report?.validIndicators ?? []).map((item) => [item.label, `${item.score}/5`, item.rationale])))}
    ${section(7, "EVIDENCE", "脱敏证据摘录", table(["编号", "脱敏表达", "类型", "平台"], (report?.evidence ?? []).map((item) => [item.id, item.excerpt, item.type, item.platform])))}
    ${section(8, "METHOD", "样本、边界与继续验证", `${table(["平台", "角色", "搜索结果", "可见节点", "纳入分析", "用途"], (report?.sampleRows ?? []).map((row) => [row.platform, row.role, number(row.searchResults), number(row.visibleNodes), number(row.usableUnits), row.purpose]))}<div class="split"><article class="panel"><h3>证据边界</h3>${items(report?.boundaries, { empty: "未提供证据边界" })}</article><article class="panel"><h3>继续验证</h3>${items(report?.questions, { ordered: true, empty: "未提供继续验证问题" })}</article></div>`)}
  `;
  return documentShell({
    title: report?.title || "社媒主题档案",
    kind: "社媒主题档案",
    capturedAt: report?.capturedAt || "未提供",
    body,
  });
}

export function buildSocialTrendStandaloneHtml(report, { title: displayTitle, intro } = {}) {
  const body = `
    <header class="hero">
      <span class="eyebrow">CURRENT SIGNALS · 已脱敏</span>
      <h1>${text(displayTitle || report?.title, "近期风向")}</h1>
      <p>${text(intro || report?.scope, "未提供扫描范围")}</p>
      ${metaPills([
        report?.timeWindow?.start && report?.timeWindow?.end ? `${report.timeWindow.start} — ${report.timeWindow.end}` : null,
        report?.scope,
        report?.depth,
        report?.capturedAt,
      ])}
      <blockquote class="hero-summary">${text(report?.conclusion, "未提供一句话结论")}</blockquote>
      ${metrics([
        ["讨论焦点", number(report?.clusters?.length)],
        ["来源组", number(report?.sourceCoverage?.length)],
        ["脱敏证据", number(report?.evidence?.length)],
      ])}
    </header>
    ${qualityWarnings(report?.parseWarnings)}
    ${section(1, "SIGNAL INDEX", "大家最近在聊什么", cards(report?.clusters, (cluster, index) => `<article class="card"><span>${text(cluster.id, String(index + 1).padStart(2, "0"))} · ${text(cluster.stage, "阶段未标注")}</span><h3>${text(cluster.topic, "未命名风向")}</h3><p>${text(cluster.action, "未提供可观察行动")}</p><dl><div><dt>为什么现在</dt><dd>${text(cluster.trigger)}</dd></div><div><dt>主要声音</dt><dd>${text(cluster.voices)}</dd></div><div><dt>需求与摩擦</dt><dd>${text(cluster.needsAndFriction)}</dd></div><div><dt>讨论分支</dt><dd>${text(cluster.branches)}</dd></div><div><dt>证据覆盖</dt><dd>${text(cluster.platforms)} · ${cluster.independentSources == null ? "来源数未提供" : `${number(cluster.independentSources)} 个独立来源`} · ${text(cluster.evidenceStrength, "强度未标注")}</dd></div></dl></article>`))}
    ${section(2, "SOURCE LEDGER", "来源覆盖", table(["来源类型", "来源 / 平台", "内容样本", "评论 / 回复", "主要用途"], (report?.sourceCoverage ?? []).map((source) => [source.sourceType, source.source, number(source.contentSamples), number(source.commentReplyNodes), source.purpose])))}
    ${section(3, "EVIDENCE", "重点证据", table(["编号", "风向", "脱敏表达", "类型", "来源", "发布时间"], (report?.evidence ?? []).map((item) => [item.id, item.clusterId, item.excerpt, item.type, item.source, item.publishedAt])))}
    ${section(4, "METHOD", "范围与边界", `<div class="split"><article class="panel"><h3>扫描范围</h3>${items(report?.scanScope, { empty: "未提供扫描范围" })}</article><article class="panel"><h3>证据边界与排除项</h3>${items(report?.boundaries, { empty: "未提供证据边界" })}</article></div>`)}
  `;
  return documentShell({
    title: displayTitle || report?.title || "近期风向",
    kind: "近期风向快照",
    capturedAt: report?.capturedAt || "未提供",
    body,
  });
}

export function standaloneSocialHtmlFilename(kind, title, capturedAt) {
  const date = String(capturedAt || "").slice(0, 10).replaceAll("-", "") || "未标日期";
  const safeTitle = String(title || "社媒报告")
    .replace(/[\\/:*?"<>|\u0000-\u001f]/gu, "-")
    .replace(/\s+/gu, "-")
    .replace(/-+/gu, "-")
    .replace(/^-|-$/gu, "")
    .slice(0, 72) || "社媒报告";
  return `${kind}-${safeTitle}-${date}.html`;
}

export function downloadStandaloneSocialHtml(html, filename) {
  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.hidden = true;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}
