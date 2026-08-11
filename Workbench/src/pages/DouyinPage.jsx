import { useEffect, useState } from "react";
import { DouyinDashboard } from "../components/douyin/DouyinDashboard";
import { PageHeader } from "../components/PageHeader";
import { loadDouyinWorks } from "../lib/api";
import "../components/douyin/douyin-dashboard.css";

const REFRESH_INTERVAL_MS = 60_000;

export function DouyinPage() {
  const [response, setResponse] = useState({
    data: null,
    source: "loading",
    error: null,
  });

  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      loadDouyinWorks().then((result) => {
        if (!cancelled) setResponse(result);
      });
    };
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    refresh();
    const interval = window.setInterval(refresh, REFRESH_INTERVAL_MS);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, []);

  if (response.source === "loading") {
    return (
      <div className="page">
        <PageHeader
          eyebrow="DOUYIN DATA"
          title="抖音数据"
          description="账号趋势、全量作品、单条生命周期与数据资产覆盖。"
        />
        <div className="dy-loading" aria-label="正在加载抖音数据">
          <div />
          <div />
          <div />
        </div>
      </div>
    );
  }

  const data = response.data;
  if (data?.available !== true) {
    return (
      <div className="page">
        <PageHeader
          eyebrow="DOUYIN DATA"
          title="抖音数据"
          description="账号趋势、全量作品、单条生命周期与数据资产覆盖。"
        />
        <div className="error-note">
          <strong>官方数据源当前不可用</strong>
          <br />
          {data?.sourcePath
            ? `已检查：${data.sourcePath}`
            : "本地服务或抖音导出数据尚未就绪。页面不会使用演示数字顶替。"}
        </div>
      </div>
    );
  }

  return (
    <div className="page page--douyin">
      <PageHeader
        eyebrow="DOUYIN DATA SYSTEM"
        title="抖音数据"
        description="从账号到单条作品的可审计数据层。累计快照、自然日新增与小时生命周期分别展示，不混用口径。"
      />
      <DouyinDashboard data={data} />
    </div>
  );
}
