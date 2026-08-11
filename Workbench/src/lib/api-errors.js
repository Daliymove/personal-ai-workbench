export const LOCAL_API_UNAVAILABLE_MESSAGE =
  "此功能仅在连接本地 Workbench 服务时可用。请回到本地工作台后再试。";

const HTML_PATTERN = /^\s*(?:<!doctype\s+html|<html|<head|<body|<)/i;

export class WorkbenchApiError extends Error {
  constructor(message, {
    status = null,
    code = "WORKBENCH_API_ERROR",
    kind = "request",
    localOnly = false,
    cause,
  } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = "WorkbenchApiError";
    this.status = status;
    this.code = code;
    this.kind = kind;
    this.localOnly = localOnly;
  }
}

function parsedJsonMessage(body) {
  try {
    const parsed = JSON.parse(body);
    return {
      message: parsed?.error?.message || parsed?.message || "",
      code: parsed?.error?.code || parsed?.code || "",
    };
  } catch {
    return { message: "", code: "" };
  }
}

export function httpApiError(status, body = "", contentType = "") {
  const normalizedStatus = Number(status) || 0;
  const text = String(body || "").trim();
  const looksJson =
    String(contentType).toLowerCase().includes("json") ||
    text.startsWith("{") ||
    text.startsWith("[");
  const parsed = looksJson ? parsedJsonMessage(text) : { message: "", code: "" };
  const looksHtml =
    String(contentType).toLowerCase().includes("html") ||
    HTML_PATTERN.test(text);

  // Hosted builds do not expose the local mutation API and normally answer
  // with an HTML/text 404. A JSON 404, however, is a valid local API business
  // response (for example, an explanation record was removed) and must retain
  // its server error code instead of disabling the whole feature.
  if ((normalizedStatus === 404 || normalizedStatus === 405) && !looksJson) {
    return new WorkbenchApiError(LOCAL_API_UNAVAILABLE_MESSAGE, {
      status: normalizedStatus,
      code: "LOCAL_API_UNAVAILABLE",
      kind: "local-only",
      localOnly: true,
    });
  }

  const safePlainText = !looksHtml && text.length <= 500 ? text : "";

  return new WorkbenchApiError(
    parsed.message || safePlainText || `请求失败（${normalizedStatus || "未知状态"}）`,
    {
      status: normalizedStatus || null,
      code: parsed.code || "WORKBENCH_API_RESPONSE_ERROR",
      kind: "response",
    },
  );
}

export function normalizeApiFailure(error) {
  if (error instanceof WorkbenchApiError) return error;
  if (error?.name === "AbortError") {
    return new WorkbenchApiError("请求超时，请检查本地 Workbench 服务后重试。", {
      code: "WORKBENCH_API_TIMEOUT",
      kind: "timeout",
      cause: error,
    });
  }
  if (error instanceof TypeError) {
    return new WorkbenchApiError("无法连接 Workbench 数据服务，请确认本地服务正在运行。", {
      code: "WORKBENCH_API_UNREACHABLE",
      kind: "network",
      cause: error,
    });
  }
  return error instanceof Error
    ? error
    : new WorkbenchApiError("Workbench 请求失败。", { cause: error });
}

export function isLocalOnlyApiError(error) {
  return Boolean(
    error?.localOnly ||
      error?.code === "LOCAL_API_UNAVAILABLE",
  );
}

export function apiErrorMessage(error, fallback) {
  if (!error) return fallback;
  if (typeof error.message === "string" && error.message.trim()) {
    return error.message.trim();
  }
  return fallback;
}
