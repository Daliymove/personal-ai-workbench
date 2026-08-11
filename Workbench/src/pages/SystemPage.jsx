import { useEffect, useState } from "react";
import { PageHeader } from "../components/PageHeader";
import { ThemeCustomizer } from "../components/ThemeCustomizer";
import { getRuntimeStatus, refreshVault } from "../lib/api";
import { formatFullDate } from "../lib/format";

export function SystemPage() {
  const [runtime, setRuntime] = useState({ data: null, source: "loading", error: null });
  const [refreshing, setRefreshing] = useState(false);

  const loadRuntime = async () => {
    const response = await getRuntimeStatus();
    setRuntime(response);
  };

  useEffect(() => {
    let cancelled = false;
    getRuntimeStatus().then((response) => {
      if (!cancelled) setRuntime(response);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const isLoading = runtime.source === "loading";
  const vault = runtime.data?.vault;
  const sync = runtime.data?.sync;
  const codex = runtime.data?.codex;
  const vaultConnected = vault?.connected === true;
  const vaultHasErrors = (vault?.errors ?? 0) > 0;
  const codexAvailable = codex?.available === true;

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await refreshVault();
      await loadRuntime();
    } catch (error) {
      console.error("刷新失败:", error);
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <div className="page page--system">
      <PageHeader
        eyebrow="SYSTEM"
        title="系统状态"
        description="检查本地 Vault 索引与 Codex 运行时连接状态"
      />

      <div className="system-grid">
        {/* Vault Index Panel */}
        <div className="panel">
          <div className="panel__head">
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <span
                className={`status-dot ${
                  isLoading
                    ? ""
                    : vaultConnected && !vaultHasErrors
                      ? "status-dot--ok"
                      : "status-dot--warn"
                }`}
              />
              <h2 className="panel__title">Vault 索引</h2>
            </div>
          </div>

          <div>
            <div className="system-kv">
              <dt>标签</dt>
              <dd>{vault?.label || "本地 Vault"}</dd>
            </div>
            <div className="system-kv">
              <dt>文档数</dt>
              <dd>{isLoading ? "—" : vault?.documents ?? "—"}</dd>
            </div>
            <div className="system-kv">
              <dt>索引时间</dt>
              <dd>{formatFullDate(vault?.generatedAt)}</dd>
            </div>
            <div className="system-kv">
              <dt>错误数</dt>
              <dd>{isLoading ? "—" : vault?.errors ?? "—"}</dd>
            </div>
            <div className="system-kv">
              <dt>文件同步</dt>
              <dd>{isLoading ? "—" : sync?.status || "—"}</dd>
            </div>
            <div className="system-kv">
              <dt>索引版本</dt>
              <dd>{isLoading ? "—" : sync?.indexVersion ?? "—"}</dd>
            </div>
          </div>

          <button
            type="button"
            className="graph-filter"
            onClick={handleRefresh}
            disabled={refreshing || !vaultConnected}
            style={{ marginTop: "16px", width: "100%" }}
          >
            {refreshing ? "重建中…" : "重建索引"}
          </button>
        </div>

        {/* Codex Runtime Panel */}
        <div className="panel">
          <div className="panel__head">
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <span
                className={`status-dot ${
                  isLoading ? "" : codexAvailable ? "status-dot--ok" : ""
                }`}
              />
              <h2 className="panel__title">Codex 运行时</h2>
            </div>
          </div>

          <div>
            <div className="system-kv">
              <dt>可用性</dt>
              <dd>
                {isLoading
                  ? "检测中"
                  : codexAvailable
                    ? "可用"
                    : "不可用"}
              </dd>
            </div>
            <div className="system-kv">
              <dt>来源</dt>
              <dd>{isLoading ? "—" : codex?.source || "—"}</dd>
            </div>
          </div>
        </div>
      </div>

      {/* Appearance theme */}
      <div className="panel" style={{ marginTop: "20px" }}>
        <div className="panel__head">
          <h2 className="panel__title">外观主题</h2>
        </div>
        <ThemeCustomizer />
      </div>
      {/* Data boundary note */}
      <div className="panel" style={{ marginTop: "20px" }}>
        <p className="provenance">
          工作台通过本地文件事件自动更新 Vault 索引；数据缺失显示为 —，不做估算。
        </p>
      </div>
    </div>
  );
}
